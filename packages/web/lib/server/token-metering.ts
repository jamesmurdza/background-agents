/**
 * Post-turn token/cost metering via tokscale.
 *
 * After an agent turn finishes, tokscale (pre-installed in the sandbox snapshot)
 * reads the agent's native session files and reports cumulative token counts +
 * cost per (session, model). We diff that cumulative against what we've already
 * recorded for the session (sum of prior delta rows) to get this turn's delta,
 * and append it to the TokenUsage ledger.
 *
 * Pricing lives entirely inside the tokscale binary — the web app owns no price
 * tables. The only thing tokscale can't know (which credential pool ran, and
 * which user) is supplied by the caller.
 *
 * Everything here is best-effort: metering must never break turn finalization.
 */

import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { agentToProvider, type Agent } from "@background-agents/common"

import {
  getSessionCumulatives,
  insertTokenUsageRows,
  ZERO_CUMULATIVE,
  type TokenUsageInsert,
  type UsagePool,
} from "@/lib/db/token-usage"
import { isFreeModel } from "@/lib/server/usage-budgets"
import { readUsageMeta } from "@/lib/server/shared-pool"

/** `tokscale models --json --group-by session,model` entry shape (subset). */
interface TokscaleEntry {
  client: string
  sessionId: string | null
  model: string | null
  provider: string | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
  messageCount: number
  performance?: { tokenCoverage?: number | null } | null
}

interface TokscaleOutput {
  entries: TokscaleEntry[]
}

const TOKSCALE_CMD = "tokscale models --json --group-by session,model"
const TOKSCALE_TIMEOUT_SEC = 60

export interface MeterTurnParams {
  userId: string
  chatId: string
  /** assistant Message id this turn's usage is attributed to */
  messageId?: string | null
  /** internal agent/provider id: "claude" | "gemini" | "opencode" | ... */
  provider: string
  /** which credential pool the turn ran against */
  pool: UsagePool
  /** the agent session id (matches tokscale's groupBy=session value) */
  sessionId: string
}

/**
 * Extract the JSON object from tokscale's stdout. tokscale may print warning
 * lines (e.g. "[tokscale] LiteLLM JSON parse failed: …") before the JSON, so we
 * can't assume the whole buffer parses. Try the whole buffer first, then fall
 * back to the substring from the first "{" to the last "}".
 */
function parseTokscaleOutput(raw: string): TokscaleOutput | null {
  const tryParse = (s: string): TokscaleOutput | null => {
    try {
      const o = JSON.parse(s) as unknown
      if (o && typeof o === "object" && Array.isArray((o as TokscaleOutput).entries)) {
        return o as TokscaleOutput
      }
    } catch {
      /* fall through */
    }
    return null
  }

  const whole = tryParse(raw.trim())
  if (whole) return whole

  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return tryParse(raw.slice(start, end + 1))
  }
  return null
}

/**
 * Run tokscale in the sandbox and append this turn's token/cost deltas to the
 * ledger. Returns the number of rows written (0 if nothing new or on any
 * failure). Never throws.
 */
export async function meterTurnUsage(
  sandbox: DaytonaSandbox,
  params: MeterTurnParams
): Promise<number> {
  const { userId, chatId, messageId, provider, pool, sessionId } = params

  if (!sessionId) return 0

  let raw: string
  try {
    const res = await sandbox.process.executeCommand(
      TOKSCALE_CMD,
      undefined,
      undefined,
      TOKSCALE_TIMEOUT_SEC
    )
    if ((res.exitCode ?? 0) !== 0) {
      console.warn(
        `[token-metering] tokscale exited ${res.exitCode} for session ${sessionId}:`,
        (res.result ?? "").slice(0, 300)
      )
      return 0
    }
    raw = res.result ?? ""
  } catch (err) {
    // tokscale missing (sandbox predates the snapshot bump) or exec failure.
    console.warn(`[token-metering] tokscale exec failed for session ${sessionId}:`, err)
    return 0
  }

  const parsed = parseTokscaleOutput(raw)
  if (!parsed) {
    console.warn(`[token-metering] could not parse tokscale output for session ${sessionId}`)
    return 0
  }

  // Only this turn's session. tokscale ids (UUIDs / "ses_…") are unique per
  // client, so matching on sessionId alone is safe.
  const entries = parsed.entries.filter((e) => e.sessionId === sessionId)
  if (entries.length === 0) {
    // Not necessarily an error: e.g. an Eliza turn (no token reporting), or the
    // CLI hadn't flushed its session file yet.
    return 0
  }

  const prior = await getSessionCumulatives(sessionId)
  const rows: TokenUsageInsert[] = []

  for (const e of entries) {
    const key = e.model ?? ""
    const prev = prior.get(key) ?? ZERO_CUMULATIVE

    // Per-component delta = current tokscale cumulative − sum of prior deltas.
    // Clamp at 0 to absorb any non-monotonic reporting (e.g. session reset).
    const d = (cur: number, was: number) => Math.max(0, Math.round(cur - was))

    const inputTokens = d(e.input, prev.inputTokens)
    const outputTokens = d(e.output, prev.outputTokens)
    const cacheReadTokens = d(e.cacheRead, prev.cacheReadTokens)
    const cacheWriteTokens = d(e.cacheWrite, prev.cacheWriteTokens)
    const reasoningTokens = d(e.reasoning, prev.reasoningTokens)
    const totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + reasoningTokens
    // Free models: tokscale misprices them, so force cost to 0. They're still
    // recorded (counted in overall totals) but flagged out of shared budgets.
    const free = isFreeModel(e.model)
    const costUsd = free ? 0 : Math.max(0, e.cost - prev.costUsd)

    // Skip no-op turns (nothing new since last capture).
    if (totalTokens === 0 && costUsd === 0) continue

    const cumulativeTokens =
      e.input + e.output + e.cacheRead + e.cacheWrite + e.reasoning

    rows.push({
      userId,
      chatId,
      messageId: messageId ?? null,
      provider,
      model: e.model ?? null,
      pool,
      freeModel: free,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalTokens,
      costUsd,
      coverage: e.performance?.tokenCoverage ?? null,
      sessionId,
      cumulativeTotal: Math.round(cumulativeTokens),
      cumulativeCost: e.cost,
    })
  }

  if (rows.length === 0) return 0

  try {
    await insertTokenUsageRows(rows)
  } catch (err) {
    console.error(`[token-metering] failed to persist usage for session ${sessionId}:`, err)
    return 0
  }

  return rows.length
}

/**
 * Meter a finished assistant turn: resolve provider/pool from the message's
 * stamped usage metadata (falling back to the chat's agent), then run tokscale.
 * Shared by the SSE stream route and the lifecycle cron finalizers — no-ops when
 * there's no session id.
 */
export async function meterAssistantTurn(
  sandbox: DaytonaSandbox,
  params: {
    userId: string
    chatId: string
    messageId: string | null
    /** The assistant Message.metadata (carries the stamped pool/provider). */
    messageMetadata: unknown
    /** chat.agent / job.agent — fallback when metadata is missing. */
    agent: string
    sessionId: string | null | undefined
  }
): Promise<number> {
  if (!params.sessionId) return 0
  const meta = readUsageMeta(params.messageMetadata)
  return meterTurnUsage(sandbox, {
    userId: params.userId,
    chatId: params.chatId,
    messageId: params.messageId,
    provider: meta?.provider ?? agentToProvider[params.agent as Agent],
    pool: meta?.pool ?? "user",
    sessionId: params.sessionId,
  })
}
