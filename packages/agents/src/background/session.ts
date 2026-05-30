/**
 * Background Session Manager
 *
 * Extracted from the monolithic Provider base class.
 * Handles all background execution logic independently.
 */

import { randomUUID } from "node:crypto"
import type { AgentDefinition, ParseContext, RunOptions } from "../core/agent"
import type { Event } from "../types/events"
import type { CodeAgentSandbox } from "../types/provider"
import type {
  PollResult,
  SessionMeta,
  StartOptions,
  TurnHandle,
} from "./types"
// Re-export for convenience (BackgroundRunPhase is used via PollResult.runPhase)
export type { BackgroundRunPhase } from "./types"
import { debugLog } from "../debug"
import { buildFullCommand } from "./command-string"
import { synthesizeCrashEvent } from "./crash"
import { formatHistory } from "./history"
import {
  withinStartupGrace,
  hasObservableBackgroundProgress,
} from "./progress"
import {
  readMeta as readSessionMeta,
  writeMeta as writeSessionMeta,
  metaUnchanged,
} from "./meta-store"

// Re-export meta helpers so existing importers (background/index.ts) keep
// resolving them from this module.
export { writeInitialSessionMeta, readProviderFromMeta } from "./meta-store"

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

  /**
   * Read the full event log from offset 0 without advancing the persisted
   * cursor. Use this on (re)connect to obtain cumulative state; subsequent
   * incremental polling continues to use getEvents().
   */
  getSnapshot(): Promise<PollResult>

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

    // Prepend conversation history to prompt when injecting context
    if (options.history?.length) {
      opts.prompt = formatHistory(options.history) + "\n\n" + (opts.prompt ?? "")
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
    const fullCommand = buildFullCommand(commandSpec)

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
    const { meta, outputContent, stillRunning } = await this.readSessionState()

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

    const result = await this.pollOutput(
      meta.outputFile,
      cursor,
      meta.rawCursor != null ? String(meta.rawCursor) : null,
      outputContent
    )
    const sawEnd = meta.sawEnd || result.events.some((e) => e.type === "end")
    return this.handlePollResult(meta, result, stillRunning, sawEnd)
  }

  async getSnapshot(): Promise<PollResult> {
    let { meta, outputContent, stillRunning } = await this.readSessionState()

    if (!meta?.outputFile) {
      return {
        sessionId: meta?.sessionId ?? this.parseContext.sessionId ?? null,
        events: [],
        cursor: "0",
        running: false,
        runPhase: "idle",
      }
    }

    // Read from offset 0 with a fresh ParseContext so we neither mutate
    // this.parseContext (owned by getEvents) nor advance the persisted cursor.
    const tempContext: ParseContext = {
      state: {},
      sessionId: meta.sessionId ?? null,
    }
    let result = await this.pollOutput(
      meta.outputFile,
      "0",
      null,
      outputContent,
      tempContext
    )
    let sawEnd = result.events.some((e) => e.type === "end")

    // Grace period: if process appears stopped without an end event, wait briefly
    // and re-check. This handles the race condition where the process just finished
    // but the output file hasn't been fully flushed yet.
    if (!stillRunning && !sawEnd) {
      // Check if we're within startup grace period
      if (withinStartupGrace(meta) && !hasObservableBackgroundProgress(result)) {
        // Still starting up, report as running
        return {
          sessionId: tempContext.sessionId,
          events: result.events,
          cursor: result.cursor,
          running: true,
          runPhase: "starting",
        }
      }

      // Not in startup grace, but give a brief window for I/O flush.
      // Retry up to 5 times with 300ms delay to handle slow file system flushes.
      for (let attempt = 0; attempt < 5 && !sawEnd; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300))

        // Re-read session state and output
        const recheck = await this.readSessionState()
        stillRunning = recheck.stillRunning
        if (recheck.outputContent !== outputContent) {
          outputContent = recheck.outputContent
          result = await this.pollOutput(
            meta.outputFile,
            "0",
            null,
            outputContent,
            { state: {}, sessionId: meta.sessionId ?? null }
          )
          sawEnd = result.events.some((e) => e.type === "end")
        }
      }
    }

    const events = stillRunning || sawEnd
      ? result.events
      : [...result.events, synthesizeCrashEvent(result.rawOutput ?? "")]

    const active = stillRunning && !sawEnd
    return {
      sessionId: tempContext.sessionId,
      events,
      cursor: result.cursor,
      running: active,
      runPhase: active ? "running" : "stopped",
    }
  }

  async isRunning(): Promise<boolean> {
    const meta = await this.readMeta()
    if (!meta?.runId || !meta.outputFile || !this.sandbox.executeCommand) {
      return false
    }
    return this.isOutputRunning(meta.outputFile, meta.pid)
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

  private readMeta(): Promise<SessionMeta | null> {
    return readSessionMeta(this.sandbox, this.sessionDir)
  }

  private writeMeta(meta: SessionMeta): Promise<void> {
    return writeSessionMeta(this.sandbox, this.sessionDir, meta)
  }

  private async writeMetaIfChanged(
    next: SessionMeta,
    prev?: SessionMeta | null
  ): Promise<void> {
    if (prev && metaUnchanged(prev, next)) return
    await this.writeMeta(next)
  }

  private async isOutputRunning(outputFile: string, pid?: number): Promise<boolean> {
    if (!this.sandbox.executeCommand) return false
    const donePath = outputFile + ".done"
    const escaped = donePath.replace(/'/g, "'\\''")

    // Check both the .done file AND whether the process is still alive.
    // The .done file indicates normal completion, but if the process was killed
    // externally (e.g., kill -9), we need to check if the PID is still running.
    // Note: We check process state instead of using kill -0 because kill -0 succeeds
    // on zombie processes (state Z). A running process has state R, S, or D.
    const checkDone = `test -f '${escaped}' 2>/dev/null; echo "DONE:$?"`
    // Check if process is alive and not a zombie - get process state
    // State: R=running, S=sleeping, D=disk sleep, Z=zombie, T=stopped
    const checkPid = pid
      ? `STATE=$(ps -p ${pid} -o state= 2>/dev/null); if [ -n "$STATE" ] && [ "$STATE" != "Z" ]; then echo "PID:0"; else echo "PID:1"; fi`
      : 'echo "PID:1"'

    const r = await this.sandbox.executeCommand(
      `${checkDone}; ${checkPid}`,
      10
    )
    const output = (r.output ?? "").trim()

    // Parse results: DONE:0 means .done file exists, PID:0 means process is alive (not zombie)
    const doneMatch = output.match(/DONE:(\d+)/)
    const pidMatch = output.match(/PID:(\d+)/)

    const doneExists = doneMatch ? doneMatch[1] === "0" : false
    const processAlive = pidMatch ? pidMatch[1] === "0" : false

    // Running if: .done doesn't exist AND process is still alive (if we have a PID to check)
    // If we have a PID and the process is dead/zombie, consider it not running even without .done
    if (pid && !processAlive) {
      return false
    }
    return !doneExists
  }

  private async pollOutput(
    outputFile: string,
    cursor: string | null | undefined,
    rawCursor: string | null | undefined,
    prefetchedContent: string | null | undefined,
    parseContext: ParseContext = this.parseContext
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
        sessionId: parseContext.sessionId,
        events: [],
        cursor: String(lines.length),
        rawCursor: String(rawLines.length),
        rawOutput,
      }
    }

    const eventsOut: Event[] = []
    let status: "running" | "completed" = "running"

    for (const line of lines.slice(startIndex)) {
      const raw = this.agent.parse(line, parseContext)
      const events = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      for (const event of events) {
        if (event.type === "session") {
          parseContext.sessionId = (event as { id: string }).id
        }
        if (event.type === "end") status = "completed"
        eventsOut.push(event)
      }
    }

    return {
      status,
      sessionId: parseContext.sessionId,
      events: eventsOut,
      cursor: String(lines.length),
      rawCursor: String(rawLines.length),
      rawOutput,
    }
  }

  private async readSessionState(): Promise<{
    meta: SessionMeta | null
    outputContent: string | null
    stillRunning: boolean
  }> {
    if (this.sandbox.pollBackgroundState) {
      const state = await this.sandbox.pollBackgroundState(this.sessionDir)
      let meta: SessionMeta | null = null
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
      return {
        meta,
        outputContent: state?.output ?? null,
        stillRunning: !state?.done,
      }
    }
    const meta = await this.readMeta()
    const stillRunning = meta?.outputFile
      ? await this.isOutputRunning(meta.outputFile)
      : false
    return { meta, outputContent: null, stillRunning }
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
      const crashEvent = synthesizeCrashEvent(result.rawOutput ?? "")
      debugLog(
        "session end",
        this.parseContext.sessionId ?? meta.sessionId,
        "reason=crashed",
        crashEvent.message
      )
      // Always log the full raw output so the real failure reason is visible
      // in server logs even when the CLI only emits JSON (which synthesizeCrashEvent
      // strips out, leaving crashEvent.output undefined). This stays on
      // unconditionally (not debugLog) — it is the only production-visible
      // record of a JSON-only crash.
      const rawTail = (result.rawOutput ?? "").trim().slice(-8192)
      console.error(
        `[background-session] agent=${this.agent.name} CRASHED\n` +
        `--- raw output (last 8KB) ---\n${rawTail || "(empty)"}\n` +
        `--- end raw output ---`
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

}
