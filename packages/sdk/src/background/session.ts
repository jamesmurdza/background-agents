/**
 * Background Session — the agent "turn manager".
 *
 * This is a thin consumer of @background-agents/sandbox-jobs. The process
 * primitive (detach, output, exit code, liveness, cancel, reattach) lives in
 * that package; this file owns only *conversation* concerns:
 *   - one job per turn,
 *   - mapping the job's output lines → typed agent events (agent.parse),
 *   - capturing/persisting the agent's resumable session id,
 *   - synthesizing a friendly crash event from a real exit code + stderr tail.
 *
 * Cold-reconnect model: a session object holds only an in-memory accumulator
 * (cumulative events + byte cursor + parse state). A cold caller starts with an
 * empty accumulator and re-seeds it from a from-zero read; subsequent polls on
 * the same object read incrementally. Everything durable lives in the sandbox:
 * the conversation meta (`<sessionDir>/meta.json`) and the job directory.
 */

import { randomUUID } from "node:crypto"
import { validateThinking } from "../thinking"
import { verifyThinkingRuntime } from "../thinking-runtime"
import {
  CANCELLED_EXIT_CODE,
  type JobHandle,
  type SandboxJobs,
} from "@background-agents/sandbox-jobs"
import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../core/agent"
import type { AgentCrashedEvent, Event } from "../types/events"
import type { CodeAgentSandbox } from "../types/provider"
import { quote } from "../utils/shell"
import type {
  BackgroundRunPhase,
  HistoryMessage,
  PollResult,
  SessionMeta,
  StartOptions,
  TurnHandle,
} from "./types"
// Re-export for convenience (BackgroundRunPhase is used via PollResult.runPhase)
export type { BackgroundRunPhase } from "./types"
import { debugLog } from "../debug"

/**
 * After a turn starts, briefly tolerate "process gone, no output yet" as
 * still-starting rather than crashed — it races the job becoming observable.
 */
const STARTUP_GRACE_MS = 4000

/**
 * Background session interface.
 */
export interface BackgroundSession {
  /** Unique session ID */
  readonly id: string
  /** Session directory in sandbox */
  readonly sessionDir: string
  /** Agent definition */
  readonly agent: AgentDefinition

  /** Start a new turn with the given prompt */
  start(prompt: string, options?: Omit<StartOptions, "prompt">): Promise<TurnHandle>

  /**
   * Cumulative snapshot of the current turn, read incrementally. The first call
   * on a fresh (cold) session object reads from the beginning; later calls on
   * the same object only fetch new bytes.
   */
  poll(): Promise<PollResult>

  /** Alias of poll(): incremental cumulative read. */
  getEvents(): Promise<PollResult>

  /** Cumulative snapshot read from offset 0 (resets the accumulator). */
  getSnapshot(): Promise<PollResult>

  /** Check if the current turn's process is still alive */
  isRunning(): Promise<boolean>

  /** Get the current turn's process-group id (legacy: "pid") */
  getPid(): Promise<number | null>

  /** Cancel the current turn */
  cancel(): Promise<void>
}

/**
 * Create a background session.
 */
export function createBackgroundSession(
  agent: AgentDefinition,
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  defaults: Omit<StartOptions, "prompt"> = {}
): BackgroundSession {
  return new BackgroundSessionImpl(agent, sandbox, sessionDir, defaults)
}

class BackgroundSessionImpl implements BackgroundSession {
  readonly id: string

  // ── In-memory, connection-scoped accumulator (Option B) ───────────────────
  private parseContext: ParseContext = { state: {}, sessionId: null }
  private cum: Event[] = []
  private cursor = 0
  private handle: JobHandle | null = null
  private startedAt = 0
  private cancelled = false
  private crashEmitted = false
  private startInFlight = false
  private acknowledgedJobId: string | null = null

  constructor(
    readonly agent: AgentDefinition,
    private sandbox: CodeAgentSandbox,
    readonly sessionDir: string,
    private defaults: Omit<StartOptions, "prompt">
  ) {
    this.id = sessionDir.replace(/.*codeagent-/, "")
  }

  private get jobs(): SandboxJobs {
    if (!this.sandbox.jobs) {
      throw new Error("Background sessions require a sandbox with jobs support")
    }
    return this.sandbox.jobs
  }

  async start(
    prompt: string,
    options: Omit<StartOptions, "prompt"> = {}
  ): Promise<TurnHandle> {
    if (this.startInFlight) throw new Error("A background turn is already starting")
    this.startInFlight = true
    try {
      return await this.startTurn(prompt, options)
    } finally {
      this.startInFlight = false
    }
  }

  private async startTurn(prompt: string, options: Omit<StartOptions, "prompt">): Promise<TurnHandle> {
    const opts: RunOptions = { ...this.defaults, ...options, prompt }
    validateThinking(this.agent.name, opts.model, opts.thinking)
    await verifyThinkingRuntime(this.agent.name, opts, this.sandbox)

    // Prepend conversation history when injecting context.
    if (options.history?.length) {
      opts.prompt = this.formatHistory(options.history) + "\n\n" + (opts.prompt ?? "")
    }
    // Synthesize a system prompt for agents without native support.
    if (opts.systemPrompt && !this.agent.capabilities?.supportsSystemPrompt) {
      opts.prompt = opts.systemPrompt + "\n\n" + (opts.prompt ?? "")
    }

    const prior = await this.readMeta()
    // Each turn is an independent job; the counter is cosmetic. Keep the first
    // turn at the initial counter, increment once a prior turn has run.
    const reusingPrepared = prior?.launchProtocol === 1 && !!prior.jobId && !this.acknowledgedJobId
    const currentTurn = reusingPrepared ? prior.currentTurn : prior?.jobId ? (prior.currentTurn ?? 0) + 1 : prior?.currentTurn ?? 0
    const sessionId = this.parseContext.sessionId ?? opts.sessionId ?? prior?.sessionId ?? null

    debugLog(
      `background turn start agent=${this.agent.name} sessionDir=${this.sessionDir} turn=${currentTurn}`,
      sessionId
    )

    // The native session can come from persisted metadata after reconnect, not
    // only from this call's options. Pass the same identity we track to the CLI.
    const spec = this.agent.buildCommand({ ...opts, sessionId: sessionId ?? undefined })
    if (opts.cwd && !spec.cwd) spec.cwd = opts.cwd

    if (prior?.cancelled || (prior?.launchProtocol === 1 && prior.jobId &&
        await this.jobs.isAborted(prior.jobId, this.sessionDir))) {
      throw new Error("This background attempt was cancelled; create a new session to retry")
    }
    if (!reusingPrepared) {
      const previousHandle = await this.reattach()
      if (previousHandle && (await this.jobs.status(previousHandle)).alive) {
        throw new Error("The previous background turn is still running")
      }
    }
    const preparedAt = reusingPrepared ? prior.launchPreparedAt! : new Date().toISOString()
    const jobId = reusingPrepared ? prior.jobId! : randomUUID()
    // Persist the discoverable attempt BEFORE launch. No mapping write after
    // launching is needed; a cold caller always knows which job to inspect or
    // fence, even when start's response disappears.
    if (!reusingPrepared) await this.writeMeta({
      currentTurn, provider: this.agent.name, sessionId, jobId,
      startedAt: preparedAt, launchPreparedAt: preparedAt, launchProtocol: 1, cancelled: false,
    })
    const handle = await this.jobs.start({
      jobId,
      command: this.renderCommand(spec),
      cwd: spec.cwd,
      env: spec.env,
      processName: this.agent.name,
      // Nest each turn's job under the session dir (one dir per job).
      root: this.sessionDir,
    })

    if (handle.jobId !== jobId) throw new Error("Sandbox returned a different execution identity")
    this.cursor = 0
    this.cum = []
    this.parseContext = { state: {}, sessionId }
    this.startedAt = Date.parse(preparedAt)
    this.cancelled = false
    this.crashEmitted = false
    this.handle = handle
    this.acknowledgedJobId = jobId

    debugLog(`background turn started agent=${this.agent.name} pgid=${handle.pgid}`, sessionId)

    return { executionId: jobId, pid: handle.pgid, outputFile: handle.outputFile }
  }

  poll(): Promise<PollResult> {
    return this.core("cumulative")
  }

  getEvents(): Promise<PollResult> {
    return this.core("delta")
  }

  /**
   * Cumulative snapshot read from offset 0. STATELESS: it uses a local parse
   * context and event buffer and does not touch this session's incremental
   * accumulator — so it is safe to call concurrently on a shared (cached)
   * session object, which is exactly how the web layer polls it.
   */
  async getSnapshot(): Promise<PollResult> {
    const handle = await this.reattach()
    if (!handle) {
      return this.unstartedSnapshot()
    }

    const ctx: ParseContext = { state: {}, sessionId: null }
    const events: Event[] = []
    const r = await this.jobs.read(handle, 0)
    const captured = this.parseLines(r.raw, ctx, events)
    if (captured) await this.patchMeta({ sessionId: captured }, handle.jobId)

    const status = r.status
    const sawEnd = events.some((e) => e.type === "end")
    const cancelled = this.cancelled || status.exitCode === CANCELLED_EXIT_CODE
    const isCrash =
      !sawEnd &&
      !cancelled &&
      (status.state === "crashed" || (status.state === "exited" && status.exitCode !== 0))

    if (isCrash && status.state === "crashed" && events.length === 0 && this.withinGrace()) {
      return {
        sessionId: ctx.sessionId,
        events,
        cursor: String(r.cursor),
        running: true,
        runPhase: "starting",
      }
    }

    let out: Event[] = events
    if (isCrash) {
      out = [...events, this.synthesizeCrashEvent(r.raw)]
      this.logCrash(r.raw)
    }

    const running = status.state === "running"
    const runPhase: BackgroundRunPhase = running
      ? this.withinGrace() && events.length === 0
        ? "starting"
        : "running"
      : "stopped"

    return { sessionId: ctx.sessionId, events: out, cursor: String(r.cursor), running, runPhase }
  }

  async isRunning(): Promise<boolean> {
    const handle = await this.reattach()
    if (!handle) return false
    return (await this.jobs.status(handle)).alive
  }

  async getPid(): Promise<number | null> {
    const handle = await this.reattach()
    return handle?.pgid ?? null
  }

  async cancel(): Promise<void> {
    const meta = await this.readMeta()
    if (meta?.launchProtocol === 1 && meta.jobId) {
      await this.jobs.abort(meta.jobId, this.sessionDir)
      this.cancelled = true
      // The sandbox tombstone is authoritative even if this convenience
      // metadata update fails. A cold reader checks the tombstone as well.
      await this.patchMeta({ cancelled: true }, meta.jobId)
      return
    }
    const handle = await this.reattach()
    if (!handle) throw new Error("Cannot safely cancel a legacy session without execution metadata")
    await this.jobs.cancel(handle)
    this.cancelled = true
    await this.patchMeta({ cancelled: true }, handle.jobId)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core poll: read (incremental or from-zero) → parse → derive state.
  // ─────────────────────────────────────────────────────────────────────────

  private async core(mode: "delta" | "cumulative"): Promise<PollResult> {
    const handle = await this.reattach()
    if (!handle) {
      return this.unstartedSnapshot()
    }

    const r = await this.jobs.read(handle, this.cursor)
    this.cursor = r.cursor

    // Events produced by THIS read (the delta). They are also appended to the
    // cumulative buffer, so we can serve either contract from one parse.
    const fresh: Event[] = []
    const capturedSession = this.parseLines(r.raw, this.parseContext, fresh)
    this.cum.push(...fresh)

    // Persist a newly-captured session id so the next turn / a cold caller can
    // resume the agent's own conversation.
    if (capturedSession) {
      await this.patchMeta({ sessionId: capturedSession }, handle.jobId)
    }

    const status = r.status
    const sawEnd = this.cum.some((e) => e.type === "end")
    const cancelled = this.cancelled || status.exitCode === CANCELLED_EXIT_CODE

    // A real exit code makes crash detection exact: the process ended abnormally
    // (gone with no exit file, or a non-zero exit) without emitting `end`, and
    // it wasn't a user cancel. `crashEmitted` keeps it idempotent across polls.
    const isCrash =
      !sawEnd &&
      !cancelled &&
      !this.crashEmitted &&
      (status.state === "crashed" ||
        (status.state === "exited" && status.exitCode !== 0))

    // Startup grace: a job that vanished instantly with no output yet is far
    // more likely still starting than truly crashed.
    if (isCrash && status.state === "crashed" && this.cum.length === 0 && this.withinGrace()) {
      return {
        sessionId: this.parseContext.sessionId,
        events: mode === "delta" ? fresh : this.cum,
        cursor: String(this.cursor),
        running: true,
        runPhase: "starting",
      }
    }

    if (isCrash) {
      // Re-read the whole log for the failure tail that drives the message.
      const full = await this.jobs.read(handle, 0)
      const crash = this.synthesizeCrashEvent(full.raw)
      this.cum.push(crash)
      fresh.push(crash)
      this.crashEmitted = true
      this.logCrash(full.raw)
    }

    const running = status.state === "running"
    const runPhase: BackgroundRunPhase = running
      ? this.withinGrace() && this.cum.length === 0
        ? "starting"
        : "running"
      : "stopped"

    return {
      sessionId: this.parseContext.sessionId,
      events: mode === "delta" ? fresh : this.cum,
      cursor: String(this.cursor),
      running,
      runPhase,
    }
  }

  /** Resolve the current turn's job handle, rehydrating from meta if cold. */
  private async reattach(): Promise<JobHandle | null> {
    const meta = await this.readMeta()
    if (!meta?.jobId) return null
    this.startedAt = meta.startedAt ? Date.parse(meta.startedAt) : 0
    this.cancelled = meta.cancelled ?? false
    if (this.parseContext.sessionId == null) {
      this.parseContext.sessionId = meta.sessionId ?? null
    }
    if (this.handle?.jobId !== meta.jobId) this.handle = await this.jobs.attach(meta.jobId, this.sessionDir)
    return this.handle
  }

  private withinGrace(): boolean {
    return this.startedAt > 0 && Date.now() - this.startedAt < STARTUP_GRACE_MS
  }

  private async unstartedSnapshot(): Promise<PollResult> {
    const meta = await this.readMeta()
    const fenced = meta?.launchProtocol === 1 && !!meta.jobId &&
      await this.jobs.isAborted(meta.jobId, this.sessionDir)
    return {
      sessionId: this.parseContext.sessionId, events: [], cursor: "0", running: false,
      runPhase: fenced ? "stopped" : "idle",
      ...(!fenced && meta?.launchProtocol === 1 && meta.launchPreparedAt &&
        Number.isFinite(Date.parse(meta.launchPreparedAt)) ? { launchPreparedAt: meta.launchPreparedAt } : {}),
    }
  }

  /**
   * Parse complete output lines into `sink`, updating `ctx` (its sessionId).
   * Returns a newly-captured agent session id, if any. No instance state is
   * touched beyond what the caller passes in — so getSnapshot() can call this
   * with locals and stay concurrency-safe.
   */
  private parseLines(raw: string, ctx: ParseContext, sink: Event[]): string | null {
    let captured: string | null = null
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parsed = this.agent.parse(trimmed, ctx)
      const events = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
      for (const event of events) {
        if (event.type === "session") {
          ctx.sessionId = (event as { id: string }).id
          captured = ctx.sessionId
        }
        sink.push(event)
      }
    }
    return captured
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation meta (durable, at <sessionDir>/meta.json)
  // ─────────────────────────────────────────────────────────────────────────

  private async readMeta(): Promise<SessionMeta | null> {
    if (!this.sandbox.executeCommand) return null
    const result = await this.sandbox.executeCommand(metadataReadCommand(this.sessionDir), 10)
    if (result.exitCode === 44) return null
    if (result.exitCode !== 0) throw new Error("Background session metadata could not be read")
    const raw = (result.output ?? "").trim()
    if (!raw) throw new Error("Background session metadata is empty")
    try {
      const o = JSON.parse(raw) as SessionMeta
      if (typeof o.currentTurn !== "number") throw new Error("Invalid background session metadata")
      return o
    } catch {
      throw new Error("Background session metadata is unreadable")
    }
  }

  private async writeMeta(meta: SessionMeta): Promise<void> {
    await writeSessionMetaRaw(this.sandbox, this.sessionDir, meta)
  }

  private async patchMeta(patch: Partial<SessionMeta>, expectedJobId?: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await this.readMeta()
      if (!cur) throw new Error("Background session metadata is missing")
      // An old poll/cancel may finish after the next turn was prepared. It
      // must not rewrite the newer turn's identity or cancellation state.
      if (expectedJobId && cur.jobId !== expectedJobId) return
      if (await writeSessionMetaRaw(this.sandbox, this.sessionDir, { ...cur, ...patch }, cur)) return
    }
    throw new Error("Background session metadata changed while updating")
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command rendering + crash synthesis + history
  // ─────────────────────────────────────────────────────────────────────────

  /** cmd + quoted args. cwd and env are handled by jobs.start(), not inlined. */
  private renderCommand(spec: CommandSpec): string {
    const args = spec.args.map((a) => quote(a)).join(" ")
    return args ? `${spec.cmd} ${args}` : spec.cmd
  }

  private logCrash(rawOutput: string): void {
    // Always log the full raw tail so the real failure reason is visible in
    // server logs even when the CLI only emitted JSON.
    const rawTail = rawOutput.trim().slice(-8192)
    console.error(
      `[background-session] agent=${this.agent.name} CRASHED\n` +
        `--- raw output (last 8KB) ---\n${rawTail || "(empty)"}\n` +
        `--- end raw output ---`
    )
  }

  private synthesizeCrashEvent(rawOutput: string): AgentCrashedEvent {
    const trimmed = rawOutput.trim()
    const nonJsonLines = trimmed.split("\n").filter((l) => {
      const t = l.trim()
      return t && !(t.startsWith("{") && t.endsWith("}"))
    })
    const nonJsonOutput = nonJsonLines.join("\n").trim()

    // ── Model not available ─────────────────────────────────────────────────
    // The Copilot CLI writes this to stderr (non-JSON) when the --model flag
    // names a model the account can't access.
    const modelNotAvailableMatch = nonJsonOutput.match(
      /Model\s+"([^"]+)"\s+(?:from --model flag\s+)?is not available/i
    )
    if (modelNotAvailableMatch) {
      return {
        type: "agent_crashed",
        message:
          `Model "${modelNotAvailableMatch[1]}" is not available on your GitHub Copilot plan. ` +
          `Select a different model (e.g. gpt-5-mini, gpt-4o, claude-haiku-4.5).`,
      }
    }

    // ── Generic crash fallback ──────────────────────────────────────────────
    const output = nonJsonOutput.slice(-4096) || undefined
    return {
      type: "agent_crashed",
      message: "Agent process exited without completing (crashed or killed)",
      output,
    }
  }

  /**
   * Format conversation history into a preamble for prompt injection.
   */
  private formatHistory(history: readonly HistoryMessage[]): string {
    const lines = history.map(
      (m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`
    )
    return (
      "## Conversation History\n" +
      "The following is the conversation history from a previous session. " +
      "Use it as context for the current request.\n\n" +
      lines.join("\n\n")
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level helpers (used by the session API for reattachment)
// ─────────────────────────────────────────────────────────────────────────────

async function writeSessionMetaRaw(
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  meta: SessionMeta,
  expected?: SessionMeta
): Promise<boolean> {
  if (!sandbox.executeCommand) {
    throw new Error("Background sessions require a sandbox with executeCommand support")
  }
  // base64 + pipe so arbitrary JSON crosses the shell without quoting hazards.
  const b64 = Buffer.from(JSON.stringify(meta), "utf8").toString("base64")
  const path = `${sessionDir}/meta.json`
  const temporary = `${path}.${randomUUID()}.tmp`
  const expectedB64 = expected ? Buffer.from(JSON.stringify(expected), "utf8").toString("base64") : null
  const result = await sandbox.executeCommand(
    `mkdir -p ${quote(sessionDir)} || exit 1; exec 9> ${quote(`${sessionDir}/meta.lock`)}; flock -x -w 5 9 || exit 1; ` +
    (expectedB64 ? `CURRENT=$(cat ${quote(path)}) || exit 1; EXPECTED=$(printf %s '${expectedB64}' | base64 -d) || exit 1; [ "$CURRENT" = "$EXPECTED" ] || exit 73; ` : "") +
    `printf %s '${b64}' | base64 -d > ${quote(temporary)} && mv ${quote(temporary)} ${quote(path)}`,
    10
  )
  if (result.exitCode === 73 && expected) return false
  if (result.exitCode !== 0) throw new Error("Background session metadata could not be saved")
  return true
}

function metadataReadCommand(sessionDir: string): string {
  const path = quote(`${sessionDir}/meta.json`)
  return `cat ${path} 2>/dev/null; RC=$?; if [ "$RC" -ne 0 ] && [ ! -e ${path} ]; then exit 44; fi; exit "$RC"`
}

/**
 * Write initial session metadata for reattachment (called when a session is
 * created, before the first turn).
 */
export async function writeInitialSessionMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  agentName: string,
  sessionId: string | null
): Promise<void> {
  if (!sandbox.executeCommand) throw new Error("Background sessions require durable metadata support")
  await writeSessionMetaRaw(sandbox, sessionDir, {
    currentTurn: 0,
    provider: agentName,
    sessionId,
    jobId: randomUUID(),
    launchProtocol: 1,
    launchPreparedAt: new Date().toISOString(),
  })
}

/**
 * Read provider name and agent session id from session metadata.
 */
export async function readProviderFromMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string
): Promise<{ provider: string | null; sessionId: string | null } | null> {
  if (!sandbox.executeCommand) return null
  const result = await sandbox.executeCommand(metadataReadCommand(sessionDir), 10)
  if (result.exitCode === 44) return null
  if (result.exitCode !== 0) throw new Error("Background session metadata could not be read")
  const raw = (result.output ?? "").trim()
  if (!raw) throw new Error("Background session metadata is empty")
  try {
    const o = JSON.parse(raw) as { provider?: string; sessionId?: string | null }
    return {
      provider: o.provider ?? null,
      sessionId: o.sessionId ?? null,
    }
  } catch {
    throw new Error("Background session metadata is unreadable")
  }
}
