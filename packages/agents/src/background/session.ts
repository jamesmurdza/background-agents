/**
 * Background Session Manager
 *
 * Extracted from the monolithic Provider base class.
 * Handles all background execution logic independently.
 */

import { randomUUID } from "node:crypto"
import type { AgentDefinition, ParseContext, RunOptions } from "../core/agent.js"
import type { Event } from "../types/events.js"
import type { CodeAgentSandbox } from "../types/provider.js"
import type {
  PollResult,
  SessionMeta,
  StartOptions,
  TurnHandle,
} from "./types.js"
// Re-export for convenience (BackgroundRunPhase is used via PollResult.runPhase)
export type { BackgroundRunPhase } from "./types.js"
import { debugLog } from "../debug.js"

/** After startedAt, ignore "done but no output" briefly (race with wrapper). */
const BACKGROUND_STARTUP_GRACE_MS = 4000

function withinStartupGrace(meta: { startedAt?: string }): boolean {
  if (!meta.startedAt) return false
  const t = Date.parse(meta.startedAt)
  if (Number.isNaN(t)) return false
  return Date.now() - t < BACKGROUND_STARTUP_GRACE_MS
}

function hasObservableBackgroundProgress(result: {
  events: Event[]
  rawOutput?: string
}): boolean {
  for (const e of result.events) {
    if (
      e.type === "token" ||
      e.type === "tool_start" ||
      e.type === "tool_end" ||
      e.type === "end"
    ) {
      return true
    }
  }
  const raw = (result.rawOutput ?? "").trim()
  const nonJsonLines = raw.split("\n").filter((l) => {
    const t = l.trim()
    return t && !(t.startsWith("{") && t.endsWith("}"))
  })
  return nonJsonLines.some((l) => l.trim().length > 0)
}

/**
 * Background session interface
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

  /** Poll for new events */
  getEvents(): Promise<PollResult>

  /** Check if a turn is currently running */
  isRunning(): Promise<boolean>

  /** Get current turn's PID */
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

/**
 * Background session implementation
 */
class BackgroundSessionImpl implements BackgroundSession {
  readonly id: string
  private parseContext: ParseContext = { state: {}, sessionId: null }

  constructor(
    readonly agent: AgentDefinition,
    private sandbox: CodeAgentSandbox,
    readonly sessionDir: string,
    private defaults: Omit<StartOptions, "prompt">
  ) {
    // Extract ID from session dir
    this.id = sessionDir.replace(/.*codeagent-/, "")
  }

  async start(
    prompt: string,
    options: Omit<StartOptions, "prompt"> = {}
  ): Promise<TurnHandle> {
    const opts: RunOptions = {
      ...this.defaults,
      ...options,
      prompt,
    }

    // Handle system prompt for agents without native support
    if (opts.systemPrompt && !this.agent.capabilities?.supportsSystemPrompt) {
      opts.prompt = opts.systemPrompt + "\n\n" + (opts.prompt ?? "")
    }

    if (!this.sandbox.executeCommand) {
      throw new Error(
        "Sandbox background mode requires a sandbox with executeCommand support"
      )
    }

    // Ensure session directory exists
    await this.sandbox.executeCommand(`mkdir -p "${this.sessionDir}"`, 10)

    // Read current meta
    const meta = await this.readMeta()
    const currentTurn = meta?.currentTurn ?? 0
    const outputFile = `${this.sessionDir}/${currentTurn}.jsonl`
    const runId = randomUUID().slice(0, 8)

    debugLog(
      `background turn start agent=${this.agent.name} sessionDir=${this.sessionDir} turn=${currentTurn}`,
      this.parseContext.sessionId
    )

    // Write initial meta before starting
    await this.writeMeta({
      currentTurn,
      cursor: 0,
      runId,
      outputFile,
      startedAt: new Date().toISOString(),
      provider: this.agent.name,
      sessionId:
        this.parseContext.sessionId ?? opts.sessionId ?? meta?.sessionId ?? null,
    })

    // Build and execute command
    const commandSpec = this.agent.buildCommand(opts)

    // Set cwd from options if not already set by agent
    if (opts.cwd && !commandSpec.cwd) {
      commandSpec.cwd = opts.cwd
    }

    // Set env vars
    if (commandSpec.env) {
      this.sandbox.setEnvVars(commandSpec.env)
    }

    // Build full command string
    const fullCommand = this.buildFullCommand(commandSpec)

    if (typeof this.sandbox.executeBackground !== "function") {
      throw new Error(
        "Background sessions require a sandbox with executeBackground support"
      )
    }

    debugLog("startSandboxBackground cli", this.parseContext.sessionId, fullCommand)

    const result = await this.sandbox.executeBackground({
      command: fullCommand,
      outputFile,
      runId,
      timeout: opts.timeout ?? 30,
    })

    // Update meta with PID
    await this.writeMeta({
      currentTurn,
      cursor: 0,
      pid: result.pid,
      runId,
      outputFile,
      startedAt: new Date().toISOString(),
      provider: this.agent.name,
      sessionId:
        this.parseContext.sessionId ?? opts.sessionId ?? meta?.sessionId ?? null,
    })

    debugLog(
      `background turn started agent=${this.agent.name} pid=${result.pid}`,
      this.parseContext.sessionId
    )

    return {
      executionId: randomUUID(),
      pid: result.pid,
      outputFile,
    }
  }

  async getEvents(): Promise<PollResult> {
    // Use optimized polling if available
    let meta: SessionMeta | null = null
    let outputContent: string | null = null
    let stillRunning: boolean

    if (this.sandbox.pollBackgroundState) {
      const state = await this.sandbox.pollBackgroundState(this.sessionDir)
      if (state?.meta) {
        try {
          const parsed = JSON.parse(state.meta)
          if (
            typeof parsed.currentTurn === "number" &&
            typeof parsed.cursor === "number"
          ) {
            meta = parsed
          }
        } catch {
          /* invalid JSON */
        }
      }
      outputContent = state?.output ?? null
      stillRunning = !state?.done
    } else {
      // Legacy path
      meta = await this.readMeta()
      stillRunning = meta?.outputFile
        ? await this.isOutputRunning(meta.outputFile)
        : false
    }

    if (!meta?.runId || !meta.outputFile) {
      debugLog(
        `getEvents (no turn in progress) sessionDir=${this.sessionDir}`,
        this.parseContext.sessionId
      )
      return {
        sessionId: meta?.sessionId ?? this.parseContext.sessionId ?? null,
        events: [],
        cursor: String(meta?.cursor ?? 0),
        running: false,
        runPhase: "idle",
      }
    }

    const cursor = String(meta.cursor)
    debugLog(
      `getEvents agent=${this.agent.name} turn=${meta.currentTurn} cursor=${cursor}`,
      this.parseContext.sessionId
    )

    // Poll output
    const result = await this.pollOutput(
      meta.outputFile,
      cursor,
      meta.rawCursor != null ? String(meta.rawCursor) : null,
      outputContent
    )
    const sawEnd = meta.sawEnd || result.events.some((e) => e.type === "end")

    // Handle completion states
    return this.handlePollResult(meta, result, stillRunning, sawEnd)
  }

  async isRunning(): Promise<boolean> {
    const meta = await this.readMeta()
    if (!meta?.runId || !meta.outputFile || !this.sandbox.executeCommand) {
      return false
    }
    return this.isOutputRunning(meta.outputFile)
  }

  async getPid(): Promise<number | null> {
    const meta = await this.readMeta()
    if (meta?.pid == null || meta.pid < 1) return null
    return meta.pid
  }

  async cancel(): Promise<void> {
    const meta = await this.readMeta()
    if (meta?.pid == null) return

    if (this.sandbox.killBackgroundProcess) {
      await this.sandbox.killBackgroundProcess(meta.pid, this.agent.name)
    } else if (this.sandbox.executeCommand) {
      await this.sandbox.executeCommand(
        `kill -TERM ${meta.pid} 2>/dev/null || true`,
        10
      )
      await new Promise((r) => setTimeout(r, 500))
      await this.sandbox.executeCommand(
        `kill -9 ${meta.pid} 2>/dev/null || true`,
        10
      )
      await this.sandbox.executeCommand(
        `pkill -9 -f "${this.agent.name}" 2>/dev/null || true`,
        10
      )
    }

    // Write done file
    if (meta.outputFile && this.sandbox.executeCommand) {
      const donePath = meta.outputFile + ".done"
      const escaped = donePath.replace(/'/g, "'\\''")
      await this.sandbox.executeCommand(
        `echo 1 > '${escaped}' 2>/dev/null || true`,
        10
      )
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async readMeta(): Promise<SessionMeta | null> {
    if (!this.sandbox.executeCommand) return null
    const result = await this.sandbox.executeCommand(
      `cat "${this.sessionDir}/meta.json" 2>/dev/null || true`,
      10
    )
    const raw = (result.output ?? "").trim()
    if (!raw) return null
    try {
      const o = JSON.parse(raw) as SessionMeta
      if (typeof o.currentTurn !== "number" || typeof o.cursor !== "number")
        return null
      return o
    } catch {
      return null
    }
  }

  private async writeMeta(meta: SessionMeta): Promise<void> {
    if (!this.sandbox.executeCommand) {
      throw new Error(
        "Sandbox background mode requires a sandbox with executeCommand support"
      )
    }
    const json = JSON.stringify(meta)
    const b64 = Buffer.from(json, "utf8").toString("base64")
    await this.sandbox.executeCommand(
      `mkdir -p "${this.sessionDir}" && echo '${b64}' | base64 -d > "${this.sessionDir}/meta.json"`,
      10
    )
  }

  private async writeMetaIfChanged(
    next: SessionMeta,
    prev?: SessionMeta | null
  ): Promise<void> {
    if (prev) {
      const unchanged =
        prev.currentTurn === next.currentTurn &&
        prev.cursor === next.cursor &&
        (prev.rawCursor ?? 0) === (next.rawCursor ?? 0) &&
        prev.pid === next.pid &&
        prev.runId === next.runId &&
        prev.outputFile === next.outputFile &&
        (prev.sawEnd ?? false) === (next.sawEnd ?? false) &&
        prev.startedAt === next.startedAt &&
        prev.provider === next.provider &&
        (prev.sessionId ?? null) === (next.sessionId ?? null)
      if (unchanged) return
    }
    await this.writeMeta(next)
  }

  private async isOutputRunning(outputFile: string): Promise<boolean> {
    if (!this.sandbox.executeCommand) return false
    const donePath = outputFile + ".done"
    const escaped = donePath.replace(/'/g, "'\\''")
    const r = await this.sandbox.executeCommand(
      `test -f '${escaped}' 2>/dev/null; echo $?`,
      10
    )
    const doneExists =
      Number((r.output ?? "").trim().split(/\s+/).pop()) === 0
    return !doneExists
  }

  private async pollOutput(
    outputFile: string,
    cursor?: string | null,
    rawCursor?: string | null,
    prefetchedContent?: string | null
  ): Promise<{
    status: "running" | "completed"
    sessionId: string | null
    events: Event[]
    cursor: string
    rawCursor: string
    rawOutput?: string
  }> {
    let rawOutput: string
    if (prefetchedContent != null) {
      rawOutput = prefetchedContent
    } else {
      if (!this.sandbox.executeCommand) {
        throw new Error(
          "Sandbox background mode requires a sandbox with executeCommand support"
        )
      }
      const result = await this.sandbox.executeCommand(
        `cat ${outputFile}`,
        30
      )
      rawOutput = result.output ?? ""
    }

    const startIndex = cursor ? Number(cursor) || 0 : 0
    void rawCursor
    const rawLines = rawOutput.split("\n")
    const lines: string[] = []
    const isJson = (s: string) => s.startsWith("{") && s.endsWith("}")

    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim()
      if (!trimmed) continue
      if (!isJson(trimmed) && i === rawLines.length - 1) continue
      if (isJson(trimmed)) lines.push(trimmed)
    }

    if (startIndex >= lines.length) {
      return {
        status: "running",
        sessionId: this.parseContext.sessionId,
        events: [],
        cursor: String(lines.length),
        rawCursor: String(rawLines.length),
        rawOutput,
      }
    }

    const eventsOut: Event[] = []
    let status: "running" | "completed" = "running"

    for (const line of lines.slice(startIndex)) {
      const raw = this.agent.parse(line, this.parseContext)
      const events = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      for (const event of events) {
        if (event.type === "session") {
          this.parseContext.sessionId = (event as { id: string }).id
        }
        if (event.type === "end") status = "completed"
        eventsOut.push(event)
      }
    }

    return {
      status,
      sessionId: this.parseContext.sessionId,
      events: eventsOut,
      cursor: String(lines.length),
      rawCursor: String(rawLines.length),
      rawOutput,
    }
  }

  private async handlePollResult(
    meta: SessionMeta,
    result: Awaited<ReturnType<typeof this.pollOutput>>,
    stillRunning: boolean,
    sawEnd: boolean
  ): Promise<PollResult> {
    const baseMeta: SessionMeta = {
      currentTurn: meta.currentTurn,
      cursor: Number(result.cursor) || 0,
      rawCursor: Number(result.rawCursor) || meta.rawCursor || 0,
      provider: this.agent.name,
      sessionId: this.parseContext.sessionId ?? meta.sessionId ?? null,
    }

    // Early poll / wrapper race
    if (
      !stillRunning &&
      !sawEnd &&
      withinStartupGrace(meta) &&
      !hasObservableBackgroundProgress(result)
    ) {
      await this.writeMetaIfChanged(
        {
          ...baseMeta,
          sawEnd: false,
          pid: meta.pid,
          runId: meta.runId,
          outputFile: meta.outputFile,
          startedAt: meta.startedAt,
        },
        meta
      )
      return {
        sessionId: result.sessionId,
        events: result.events,
        cursor: result.cursor,
        running: true,
        runPhase: "starting",
      }
    }

    if (!stillRunning || sawEnd) {
      const nextTurn = (meta.currentTurn ?? 0) + 1
      await this.writeMetaIfChanged(
        {
          ...baseMeta,
          currentTurn: nextTurn,
          sawEnd,
          ...(sawEnd
            ? {}
            : { outputFile: meta.outputFile, runId: meta.runId }),
        },
        meta
      )
    } else {
      await this.writeMetaIfChanged(
        {
          ...baseMeta,
          sawEnd,
          pid: meta.pid,
          runId: meta.runId,
          outputFile: meta.outputFile,
          startedAt: meta.startedAt,
        },
        meta
      )
    }

    // Crashed: process exited without end event
    if (!stillRunning && !sawEnd) {
      const raw = (result.rawOutput ?? "").trim()
      const nonJsonLines = raw.split("\n").filter((l) => {
        const t = l.trim()
        return t && !(t.startsWith("{") && t.endsWith("}"))
      })
      const output = nonJsonLines.join("\n").trim().slice(-4096) || undefined
      const crashEvent: Event = {
        type: "agent_crashed",
        message: "Agent process exited without completing (crashed or killed)",
        output,
      }
      debugLog(
        "session end",
        this.parseContext.sessionId ?? meta.sessionId,
        "reason=crashed",
        crashEvent.message
      )
      await this.writeMetaIfChanged(
        {
          ...baseMeta,
          currentTurn: (meta.currentTurn ?? 0) + 1,
          sawEnd: true,
        },
        meta
      )
      return {
        sessionId: result.sessionId,
        events: [...result.events, crashEvent],
        cursor: result.cursor,
        running: false,
        runPhase: "stopped",
      }
    }

    const active = stillRunning && !sawEnd
    return {
      sessionId: result.sessionId,
      events: result.events,
      cursor: result.cursor,
      running: active,
      runPhase: active ? "running" : "stopped",
    }
  }

  private buildFullCommand(spec: { cmd: string; args: string[]; cwd?: string }): string {
    const quotedArgs = spec.args.map((arg) => this.quoteArg(arg))
    const command = [spec.cmd, ...quotedArgs].join(" ")
    // If cwd is specified, prepend a cd command
    if (spec.cwd) {
      const safeCwd = spec.cwd.replace(/'/g, "'\\''")
      return `cd '${safeCwd}' && ${command}`
    }
    return command
  }

  private quoteArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`
  }
}

/**
 * Write initial session metadata for reattachment.
 */
export async function writeInitialSessionMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  agentName: string,
  sessionId: string | null
): Promise<void> {
  if (!sandbox.executeCommand) return
  const meta: SessionMeta = {
    currentTurn: 0,
    cursor: 0,
    provider: agentName,
    sessionId,
  }
  const json = JSON.stringify(meta)
  const b64 = Buffer.from(json, "utf8").toString("base64")
  await sandbox.executeCommand(
    `mkdir -p "${sessionDir}" && echo '${b64}' | base64 -d > "${sessionDir}/meta.json"`,
    10
  )
}

/**
 * Read provider name from session metadata.
 */
export async function readProviderFromMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string
): Promise<{ provider: string | null; sessionId: string | null } | null> {
  if (!sandbox.executeCommand) return null
  const result = await sandbox.executeCommand(
    `cat "${sessionDir}/meta.json" 2>/dev/null || true`,
    10
  )
  const raw = (result.output ?? "").trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { provider?: string; sessionId?: string | null }
    return {
      provider: o.provider ?? null,
      sessionId: o.sessionId ?? null,
    }
  } catch {
    return { provider: null, sessionId: null }
  }
}
