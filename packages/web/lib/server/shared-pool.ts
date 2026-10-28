/**
 * Shared credential pool resolution (server-only).
 *
 * Three agents can run against a server-provided "shared" credential when the
 * user hasn't stored their own key/token: Claude Code (rotating OAuth pool),
 * Gemini and OpenCode (server env keys). Everything else always uses the user's
 * own key. This module centralizes:
 *   - which agents have a shared pool,
 *   - the internal provider id used as the TokenUsage.provider / tokscale client,
 *   - resolving whether a given run is "shared" vs "user" for metering & limits.
 *
 * It also defines the small `metadata.usage` blob stamped on the assistant
 * message at send time so the turn finalizer (which runs later, in the cron)
 * can attribute the run without re-deriving credentials.
 */

import {
  agentToProvider,
  ENDPOINT_MODEL_PREFIX,
  modelRequiresKey,
  type Agent,
  type Credentials,
  type ProviderName,
} from "@background-agents/common"
import type { UsagePool } from "@/lib/db/token-usage"
import { fingerprintKey } from "@/lib/server/shared-key-pools"

/** Agents backed by a shared (server-provided) credential pool. */
export const SHARED_POOL_AGENTS = ["claude-code", "gemini", "opencode"] as const

/** Internal provider id for an agent (stored as TokenUsage.provider). */
export function providerForAgent(agent: Agent): ProviderName {
  return agentToProvider[agent]
}

/**
 * Internal provider a specific run is billed to. Usually the agent's own
 * provider, but a Gemini model selected under a BYOK agent (Pi, Droid) runs on
 * the shared Gemini key, so it meters against the Gemini pool. Mirrors the
 * Gemini rule in {@link resolvePool}, so the two stay in agreement about which
 * runs count as shared Gemini usage.
 */
export function providerForRun(agent: Agent, model?: string): ProviderName {
  if (modelRequiresKey(agent, model) === "gemini") return "gemini"
  return providerForAgent(agent)
}

/**
 * Whether a run uses the shared pool ("shared") or the user's own key ("user").
 *
 * `storedCreds` MUST be the user's DB-stored credentials WITHOUT process.env
 * fallback, so server env keys correctly read as shared rather than user-owned.
 * Non-shared-pool agents are always "user".
 *
 * `model` lets a per-run custom-endpoint selection read as "user" even when the
 * account has no stored Claude token (the run uses the user's own endpoint, not
 * the shared pool). Omit it for account-level checks.
 */
export function resolvePool(
  agent: Agent,
  storedCreds: Credentials,
  model?: string
): UsagePool {
  // A custom endpoint (any `endpoint:<id>`) is the user's own endpoint, never the
  // shared pool — regardless of agent.
  if (model?.startsWith(ENDPOINT_MODEL_PREFIX)) return "user"
  switch (agent) {
    case "claude-code":
      return storedCreds.CLAUDE_CODE_CREDENTIALS ? "user" : "shared"
    case "gemini":
      return storedCreds.GEMINI_API_KEY ? "user" : "shared"
    case "opencode":
      return storedCreds.OPENCODE_API_KEY ? "user" : "shared"
    default:
      // A Gemini model under a BYOK agent (Pi, Droid) runs on the shared Gemini
      // key unless the user stored their own — meter those as the Gemini pool.
      if (modelRequiresKey(agent, model) === "gemini") {
        return storedCreds.GEMINI_API_KEY ? "user" : "shared"
      }
      return "user"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assistant-message metadata carrier
// ─────────────────────────────────────────────────────────────────────────────

/** Shape stamped under Message.metadata.usage at send time. */
export interface UsageMeta {
  pool: UsagePool
  provider: ProviderName
  /**
   * Fingerprint (last 5 chars) of the shared-pool key that served this run.
   * Only present for shared OpenCode runs — the one pool with several rotating
   * keys. Absent for own-key runs and single-credential pools.
   */
  keyId?: string
  /**
   * The model this run was actually started with.
   *
   * Normally redundant — tokscale reports the model itself. It exists for the
   * CLIs that don't: Droid runs a BYOK model through a synthetic
   * `custom:byok-0` entry and writes `byok-0` as the model id, which no price
   * table can resolve, so the turn would meter at $0. Metering falls back to
   * this when tokscale's id is a known placeholder (see token-metering).
   *
   * Omitted for custom endpoints, whose `endpoint:<id>` value names our config
   * row rather than a model anyone can price.
   */
  model?: string
}

/**
 * Build the metadata blob to stamp on the assistant message.
 *
 * `resolvedKey` is the credential actually handed to the agent for this run
 * (i.e. `credentials.OPENCODE_API_KEY` after {@link getUserCredentials} has
 * picked one from the pool). It is fingerprinted — never stored whole — and only
 * when this run genuinely draws on the shared OpenCode pool, so a user's own key
 * never leaves a trace in the ledger.
 */
export function buildUsageMeta(
  agent: Agent,
  storedCreds: Credentials,
  model?: string,
  resolvedKey?: string
): UsageMeta {
  const pool = resolvePool(agent, storedCreds, model)
  const provider = providerForRun(agent, model)
  const keyId =
    pool === "shared" && provider === "opencode"
      ? fingerprintKey(resolvedKey)
      : undefined
  // An `endpoint:<id>` value names a config row, not a model, so it would be
  // useless (and misleading) as a pricing fallback.
  const runModel =
    model && !model.startsWith(ENDPOINT_MODEL_PREFIX) ? model : undefined
  return {
    pool,
    provider,
    ...(keyId ? { keyId } : {}),
    ...(runModel ? { model: runModel } : {}),
  }
}

/**
 * Read back the usage metadata from a Message.metadata JSON value. Returns null
 * when absent or malformed (e.g. messages predating this feature).
 */
export function readUsageMeta(metadata: unknown): UsageMeta | null {
  if (!metadata || typeof metadata !== "object") return null
  const usage = (metadata as { usage?: unknown }).usage
  if (!usage || typeof usage !== "object") return null
  const { pool, provider, keyId, model } = usage as {
    pool?: unknown
    provider?: unknown
    keyId?: unknown
    model?: unknown
  }
  if ((pool === "shared" || pool === "user") && typeof provider === "string") {
    return {
      pool,
      provider: provider as ProviderName,
      ...(typeof keyId === "string" && keyId ? { keyId } : {}),
      ...(typeof model === "string" && model ? { model } : {}),
    }
  }
  return null
}
