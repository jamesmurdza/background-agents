import { spawn } from "node:child_process"
import * as readline from "node:readline"
import { randomUUID } from "node:crypto"
import { debugLog } from "../debug.js"
import type {
  Event,
  IProvider,
  ProviderCommand,
  ProviderName,
  RunOptions,
  ProviderOptions,
  RunDefaults,
} from "../types/index.js"
import { getDefaultSessionPath, loadSession, storeSession } from "../utils/session.js"
import { ensureCliInstalled } from "../utils/install.js"
import type { CodeAgentSandbox } from "../types/index.js"
import { adaptSandbox } from "../sandbox/index.js"

/**
 * Abstract base class for AI coding agent providers
 */
export abstract class Provider implements IProvider {
  abstract readonly name: ProviderName

  sessionId: string | null = null

  getSessionId(): string | null {
    return this.sessionId
  }

  /** Sandbox for secure execution */
  protected sandboxManager: CodeAgentSandbox | null = null

  /** Whether local execution is allowed */
  protected allowLocalExecution: boolean = false

  /** Resolves when initial setup (install + env) has completed. */
  private _readyPromise: Promise<void> | null = null

  /** Env passed at creation; used for setup and when run() omits env */
  private _creationEnv: Record<string, string> | undefined

  /** Defaults merged into every run (model, timeout, sessionId, env). Set by createSession. */
  private _runDefaults: RunDefaults = {}

  /** Tracks whether we've already applied a synthetic system prompt for this session. */
  private _systemPromptApplied = false

  get ready(): Promise<void> {
    return this._readyPromise ?? Promise.resolve()
  }

  constructor(options: ProviderOptions = {}) {
    this._creationEnv = options.env
    this._runDefaults = options.runDefaults ?? {}
    if (options.sandbox) {
      this.sandboxManager = adaptSandbox(options.sandbox, { env: options.env })
      if (!options.skipInstall) {
        this._readyPromise = new Promise<void>((resolve, reject) => {
          queueMicrotask(() => this._doSetup().then(resolve).catch(reject))
        })
      }
    } else if (options.dangerouslyAllowLocalExecution) {
      this.allowLocalExecution = true
    } else {
      throw new Error(
        "Provider requires either a sandbox or dangerouslyAllowLocalExecution: true. " +
        "For secure execution, create a sandbox with @daytonaio/sdk and pass it in:\n\n" +
        "  import { Daytona } from '@daytonaio/sdk'\n" +
        "  import { createProvider } from '@jamesmurdza/coding-agents-sdk'\n" +
        "  const daytona = new Daytona({ apiKey: '...' })\n" +
        "  const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: '...' } })\n" +
        "  const provider = createProvider('claude', { sandbox })\n\n" +
        "For local execution (dangerous), use:\n\n" +
        "  const provider = createProvider('claude', { dangerouslyAllowLocalExecution: true })"
      )
    }
  }

  /**
   * Get the command configuration for this provider
   */
  abstract getCommand(options?: RunOptions): ProviderCommand

  /**
   * Parse a line of output into an event
   */
  abstract parse(line: string): Event | Event[] | null

  /**
   * Apply a synthetic system prompt for providers without native support by
   * prepending it to the first user prompt in the session. Claude uses its
   * native CLI flag instead, so we leave the prompt unchanged there.
   */
  private _applySystemPrompt(options: RunOptions): RunOptions {
    if (options.systemPrompt && !this._systemPromptApplied) {
      const supportsNativeSystemPrompt = this.name === "claude"
      if (!supportsNativeSystemPrompt) {
        const basePrompt = options.prompt ?? ""
        options.prompt = basePrompt
          ? `${options.systemPrompt}\n\n${basePrompt}`
          : options.systemPrompt
      }
      this._systemPromptApplied = true
    }
    return options
  }

  /**
   * Run the provider and yield events. Pass a prompt string or full RunOptions.
   * When created via createSession, runDefaults are merged in (e.g. model, timeout).
   */
  async *run(promptOrOptions: string | RunOptions = {}): AsyncGenerator<Event, void, unknown> {
    let options: RunOptions =
      typeof promptOrOptions === "string"
        ? { ...this._runDefaults, prompt: promptOrOptions }
        : { ...this._runDefaults, ...promptOrOptions }

    options = this._applySystemPrompt(options)

    debugLog(`run start provider=${this.name} promptLength=${options.prompt?.length ?? 0}`)
    if (this.sandboxManager) {
      yield* this.runSandbox(options)
    } else if (this.allowLocalExecution) {
      yield* this.runLocal(options)
    } else {
      throw new Error("No execution mode configured")
    }
    debugLog(`run end provider=${this.name}`)
  }

  private async _codexLoginIfNeeded(env: Record<string, string> | undefined): Promise<void> {
    if (
      this.name !== "codex" ||
      !env?.OPENAI_API_KEY ||
      !this.sandboxManager?.executeCommand
    )
      return
    const safeKey = env.OPENAI_API_KEY.replace(/'/g, "'\\''")
    await this.sandboxManager.executeCommand(
      `echo '${safeKey}' | codex login --with-api-key 2>&1`,
      30
    )
  }

  /** One-time setup: install CLI and set env. Run in microtask so subclass name is set. */
  private async _doSetup(): Promise<void> {
    if (!this.sandboxManager) return
    const t = Date.now()
    await this.sandboxManager.ensureProvider(this.name)
    console.log(`[timing] ensureProvider(${this.name}) took ${Date.now() - t}ms`)
    if (this._creationEnv) this.sandboxManager.setEnvVars(this._creationEnv)
  }

  /** Per-run: set env and Codex login. */
  private async _applyRunEnv(options: RunOptions): Promise<void> {
    if (!this.sandboxManager) return
    const env = options.env ?? this._creationEnv
    if (env) this.sandboxManager.setEnvVars(env)
    await this._codexLoginIfNeeded(env)
  }

  /**
   * Run in a secure Daytona sandbox
   */
  private async *runSandbox(options: RunOptions): AsyncGenerator<Event, void, unknown> {
    if (!this.sandboxManager) {
      throw new Error("Sandbox manager not configured")
    }
    await (this._readyPromise ?? Promise.resolve())
    await this._applyRunEnv(options)

    // Build the command
    const { cmd, args, env: cmdEnv } = this.getCommand(options)

    // Set command-specific env vars
    if (cmdEnv) {
      this.sandboxManager.setEnvVars(cmdEnv)
    }

    // Build full command string
    const fullCommand = [cmd, ...args.map(arg =>
      arg.includes(" ") || arg.includes('"') || arg.includes("'")
        ? `'${arg.replace(/'/g, "'\\''")}'`
        : arg
    )].join(" ")

    const timeout = options.timeout ?? 120

    debugLog(`runSandbox command start provider=${this.name} timeout=${timeout}`)
    let pendingToolEnd = false
    for await (const line of this.sandboxManager.executeCommandStream(fullCommand, timeout)) {
      debugLog(`raw line (sandbox): ${line.length > 300 ? line.slice(0, 300) + "…" : line}`)
      const raw = this.parse(line)
      if (raw === null) {
        debugLog(`unparsed line (sandbox): ${line.length > 200 ? line.slice(0, 200) + "…" : line}`)
      }
      const events = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      for (const event of events) {
        if (event.type === "session") {
          this.sessionId = event.id
        }
        if (event.type === "tool_start") pendingToolEnd = true
        if (event.type === "tool_end") pendingToolEnd = false
        if (event.type === "end" && pendingToolEnd) {
          yield { type: "tool_end" }
          pendingToolEnd = false
        }
        yield event
      }
    }
    debugLog(`runSandbox stream ended provider=${this.name}`)
  }

  /**
   * Run directly on local machine (dangerous - use with caution)
   */
  private async *runLocal(options: RunOptions): AsyncGenerator<Event, void, unknown> {
    // Ensure CLI is installed locally
    ensureCliInstalled(this.name, !(options.skipInstall ?? false))

    // Load session from file if not provided and persistence is enabled
    const sessionFile = options.sessionFile ?? getDefaultSessionPath(this.name)

    if (options.sessionId) {
      this.sessionId = options.sessionId
    } else if (options.persistSession !== false) {
      this.sessionId = loadSession(sessionFile)
    }

    const { cmd, args, env: cmdEnv } = this.getCommand(options)

    const proc = spawn(cmd, args, {
      stdio: ["inherit", "pipe", "inherit"],
      cwd: options.cwd,
      env: {
        ...process.env,
        ...cmdEnv,
        ...options.env,
      },
    })

    const rl = readline.createInterface({ input: proc.stdout! })
    let pendingToolEnd = false

    debugLog(`runLocal started provider=${this.name}`)
    for await (const line of rl) {
      debugLog(`raw line (local): ${line.length > 300 ? line.slice(0, 300) + "…" : line}`)
      const raw = this.parse(line)
      if (raw === null) {
        debugLog(`unparsed line (local): ${line.length > 200 ? line.slice(0, 200) + "…" : line}`)
      }
      const events = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      for (const event of events) {
        if (event.type === "session") {
          this.sessionId = event.id
          if (options.persistSession !== false) {
            storeSession(sessionFile, event.id)
          }
        }
        if (event.type === "tool_start") pendingToolEnd = true
        if (event.type === "tool_end") pendingToolEnd = false
        if (event.type === "end" && pendingToolEnd) {
          yield { type: "tool_end" }
          pendingToolEnd = false
        }
        yield event
      }
    }

    // Wait for process to close
    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => {
        debugLog(`runLocal process closed provider=${this.name} code=${code}`)
        if (code && code !== 0) {
          reject(new Error(`Provider process exited with code ${code}`))
        } else {
          resolve()
        }
      })
      proc.on("error", reject)
    })
  }

  /** Meta stored in sandbox for background session (one log per turn, cursor in meta). */
  protected async readSandboxMeta(sessionDir: string): Promise<{
    currentTurn: number
    cursor: number
    pid?: number
    runId?: string
    outputFile?: string
    sawEnd?: boolean
    startedAt?: string
    provider?: import("../types/index.js").ProviderName
    sessionId?: string | null
  } | null> {
    if (!this.sandboxManager?.executeCommand) return null
    const result = await this.sandboxManager.executeCommand(
      `cat "${sessionDir}/meta.json" 2>/dev/null || true`,
      10
    )
    const raw = (result.output ?? "").trim()
    if (!raw) return null
    try {
      const o = JSON.parse(raw) as {
        currentTurn?: number
        cursor?: number
        pid?: number
        runId?: string
        outputFile?: string
        sawEnd?: boolean
        startedAt?: string
        provider?: import("../types/index.js").ProviderName
        sessionId?: string | null
      }
      if (typeof o.currentTurn !== "number" || typeof o.cursor !== "number") return null
      return {
        currentTurn: o.currentTurn,
        cursor: o.cursor,
        pid: o.pid,
        runId: o.runId,
        outputFile: o.outputFile,
        sawEnd: o.sawEnd,
        startedAt: o.startedAt,
        provider: o.provider,
        sessionId: o.sessionId ?? null,
      }
    } catch {
      return null
    }
  }

  /** Write initial session meta at creation so getBackgroundSession can reattach before first start(). */
  async writeInitialSessionMeta(sessionDir: string): Promise<void> {
    if (!this.sandboxManager?.executeCommand) return
    await this.writeSandboxMeta(sessionDir, {
      currentTurn: 0,
      cursor: 0,
      provider: this.name,
      sessionId: this.sessionId ?? null,
    })
  }

  protected async writeSandboxMeta(
    sessionDir: string,
    meta: {
      currentTurn: number
      cursor: number
      pid?: number
      runId?: string
      outputFile?: string
      sawEnd?: boolean
      startedAt?: string
      provider?: import("../types/index.js").ProviderName
      sessionId?: string | null
    }
  ): Promise<void> {
    if (!this.sandboxManager?.executeCommand) {
      throw new Error("Sandbox background mode requires a sandbox with executeCommand support")
    }
    const json = JSON.stringify(meta)
    const b64 = Buffer.from(json, "utf8").toString("base64")
    await this.sandboxManager.executeCommand(
      `mkdir -p "${sessionDir}" && echo '${b64}' | base64 -d > "${sessionDir}/meta.json"`,
      10
    )
  }

  /**
   * Start a new turn in a session directory: one log file per turn, meta in sandbox.
   * Uses currentTurn for this run; currentTurn is incremented when the turn ends (in getEvents).
   * Writes meta with runId/outputFile before starting so reattaching clients see "running" immediately.
   */
  async startSandboxBackgroundTurn(
    sessionDir: string,
    options: RunOptions
  ): Promise<{ executionId: string; pid: number; outputFile: string }> {
    const t0 = Date.now()
    if (!this.sandboxManager?.executeCommand) {
      throw new Error("Sandbox background mode requires a sandbox with executeCommand support")
    }
    await this.sandboxManager.executeCommand(`mkdir -p "${sessionDir}"`, 10)
    console.log(`[timing] mkdir took ${Date.now() - t0}ms (elapsed ${Date.now() - t0}ms)`)
    let t = Date.now()
    const meta = await this.readSandboxMeta(sessionDir)
    console.log(`[timing] readSandboxMeta took ${Date.now() - t}ms (elapsed ${Date.now() - t0}ms)`)
    const currentTurn = meta?.currentTurn ?? 0
    const outputFile = `${sessionDir}/${currentTurn}.jsonl`
    const runId = randomUUID().slice(0, 8)
    debugLog(`background turn start provider=${this.name} sessionDir=${sessionDir} turn=${currentTurn} outputFile=${outputFile}`)
    t = Date.now()
    await this.writeSandboxMeta(sessionDir, {
      currentTurn,
      cursor: 0,
      runId,
      outputFile,
      startedAt: new Date().toISOString(),
      provider: this.name,
      sessionId: this.sessionId ?? options.sessionId ?? meta?.sessionId ?? null,
    })
    console.log(`[timing] writeSandboxMeta(1) took ${Date.now() - t}ms (elapsed ${Date.now() - t0}ms)`)
    t = Date.now()
    const result = await this.startSandboxBackground({ ...options, outputFile, runId })
    console.log(`[timing] startSandboxBackground took ${Date.now() - t}ms (elapsed ${Date.now() - t0}ms)`)
    debugLog(`background turn started provider=${this.name} pid=${result.pid} executionId=${result.executionId}`)
    t = Date.now()
    await this.writeSandboxMeta(sessionDir, {
      currentTurn,
      cursor: 0,
      pid: result.pid,
      runId: result.runId,
      outputFile,
      startedAt: new Date().toISOString(),
      provider: this.name,
      sessionId: this.sessionId ?? options.sessionId ?? meta?.sessionId ?? null,
    })
    console.log(`[timing] writeSandboxMeta(2) took ${Date.now() - t}ms (elapsed ${Date.now() - t0}ms)`)
    return { executionId: result.executionId, pid: result.pid, outputFile }
  }

  /**
   * Get the current turn's process id from sandbox meta, or null if no run in progress.
   */
  async getSandboxBackgroundPid(sessionDir: string): Promise<number | null> {
    const meta = await this.readSandboxMeta(sessionDir)
    if (meta?.pid == null || meta.pid < 1) return null
    return meta.pid
  }

  /**
   * Cancel the current turn's process in the sandbox (kill pid from meta).
   * Uses killBackgroundProcess when available (same channel as start, e.g. SSH); else executeCommand.
   * Writes the done file after kill so isRunning() becomes false (the wrapper never gets to write it).
   */
  async cancelSandboxBackground(sessionDir: string): Promise<void> {
    const meta = await this.readSandboxMeta(sessionDir)
    if (meta?.pid == null) return
    const mgr = this.sandboxManager
    if (mgr?.killBackgroundProcess) {
      await mgr.killBackgroundProcess(meta.pid)
    } else if (mgr?.executeCommand) {
      await mgr.executeCommand(`kill ${meta.pid} 2>/dev/null || true`, 10)
    }
    if (meta.outputFile && mgr?.executeCommand) {
      const donePath = meta.outputFile + ".done"
      const escaped = donePath.replace(/'/g, "'\\''")
      await mgr.executeCommand(`echo 1 > '${escaped}' 2>/dev/null || true`, 10)
    }
  }

  /**
   * Check if the current turn's process is still running in the sandbox.
   * True only while a turn is in progress; false until the next turn starts.
   * Uses the done file (outputFile.done): the wrapper writes it when the command exits.
   * We don't use kill -0 / ps here because the process is started over SSH; the process API
   * runs in a different context and can't see that pid. Kill would only work over the same SSH.
   */
  async isSandboxBackgroundProcessRunning(sessionDir: string): Promise<boolean> {
    const meta = await this.readSandboxMeta(sessionDir)
    if (!meta?.runId || !meta.outputFile || !this.sandboxManager?.executeCommand) {
      debugLog(`isRunning false (no run) sessionDir=${sessionDir}`)
      return false
    }
    const donePath = meta.outputFile + ".done"
    const escaped = donePath.replace(/'/g, "'\\''")
    const r = await this.sandboxManager.executeCommand(`test -f '${escaped}' 2>/dev/null; echo $?`, 10)
    const doneExists = Number((r.output ?? "").trim().split(/\s+/).pop()) === 0
    const running = !doneExists
    debugLog(`isRunning ${running} (done file ${doneExists ? "exists" : "missing"}) sessionDir=${sessionDir}`)
    return running
  }

  /**
   * Get new events for the current turn; reads and updates cursor in sandbox meta.
   * Use isSandboxBackgroundProcessRunning() to check if the agent is still running.
   */
  async getEventsSandboxBackgroundFromMeta(sessionDir: string): Promise<{
    sessionId: string | null
    events: Event[]
    cursor: string
  }> {
    const meta = await this.readSandboxMeta(sessionDir)
    if (!meta?.runId || !meta.outputFile) {
      debugLog(`getEventsSandboxBackgroundFromMeta provider=${this.name} sessionDir=${sessionDir} (no turn in progress)`)
      return {
        sessionId: meta?.sessionId ?? this.sessionId ?? null,
        events: [],
        cursor: String(meta?.cursor ?? 0),
      }
    }
    const outputFile = meta.outputFile
    const cursor = String(meta.cursor)
    debugLog(`getEventsSandboxBackgroundFromMeta provider=${this.name} sessionDir=${sessionDir} turn=${meta.currentTurn} cursor=${cursor}`)
    const result = await this.pollSandboxBackground(outputFile, cursor)
    const sawEnd = meta.sawEnd || result.events.some((e) => e.type === "end")
    const stillRunning = await this.isSandboxBackgroundProcessRunning(sessionDir)
    // Clear run when process stopped or we've seen end event (sawEnd can be true before .done file exists)
    if (!stillRunning || sawEnd) {
      const nextTurn = (meta.currentTurn ?? 0) + 1
      const metaUpdate = {
        currentTurn: nextTurn,
        cursor: Number(result.cursor) || 0,
        sawEnd,
        provider: this.name as import("../types/index.js").ProviderName,
        sessionId: this.sessionId ?? meta.sessionId ?? null,
        ...(sawEnd ? {} : { outputFile: meta.outputFile, runId: meta.runId }),
      }
      await this.writeSandboxMeta(sessionDir, metaUpdate)
    }
    if (stillRunning && !sawEnd) {
      await this.writeSandboxMeta(sessionDir, {
        currentTurn: meta.currentTurn,
        cursor: Number(result.cursor) || 0,
        pid: meta.pid,
        runId: meta.runId,
        outputFile: meta.outputFile,
        sawEnd,
        startedAt: meta.startedAt,
        provider: this.name,
        sessionId: this.sessionId,
      })
    }
    if (!stillRunning && !sawEnd) {
      const maxOutputChars = 4096
      let output: string | undefined
      if (this.sandboxManager?.executeCommand) {
        const outResult = await this.sandboxManager.executeCommand(`cat ${outputFile} 2>/dev/null || true`, 10)
        const raw = (outResult.output ?? "").trim()
        output = raw.length > maxOutputChars ? raw.slice(-maxOutputChars) : raw || undefined
      }
      const crashEvent: Event = {
        type: "agent_crashed",
        message: "Agent process exited without completing (crashed or killed)",
        output,
      }
      const nextTurn = (meta.currentTurn ?? 0) + 1
      await this.writeSandboxMeta(sessionDir, {
        currentTurn: nextTurn,
        cursor: Number(result.cursor) || 0,
        sawEnd: true,
        provider: this.name,
        sessionId: this.sessionId ?? meta.sessionId ?? null,
      })
      return { sessionId: result.sessionId, events: [...result.events, crashEvent], cursor: result.cursor }
    }
    return { sessionId: result.sessionId, events: result.events, cursor: result.cursor }
  }

  /**
   * Start a background run inside the sandbox.
   * The CLI is run with stdout redirected to an append-only JSONL log file.
   * Later you can call pollSandboxBackground(outputFile, cursor) to consume new events.
   * If options.runId is provided (e.g. from startSandboxBackgroundTurn), it is used so meta can be written before this returns.
   */
  async startSandboxBackground(
    options: RunOptions & { outputFile: string; runId?: string }
  ): Promise<{
    executionId: string
    pid: number
    runId: string
    outputFile: string
    cursor: string
  }> {
    if (!this.sandboxManager || !this.sandboxManager.executeCommand) {
      throw new Error("Sandbox background mode requires a sandbox with executeCommand support")
    }

    const t0 = Date.now()
    let t = Date.now()
    await (this._readyPromise ?? Promise.resolve())
    console.log(`[timing] _readyPromise took ${Date.now() - t}ms`)
    t = Date.now()
    const optsWithSystem = this._applySystemPrompt(options)
    await this._applyRunEnv(optsWithSystem)
    console.log(`[timing] _applyRunEnv took ${Date.now() - t}ms`)

    const { cmd, args, env: cmdEnv } = this.getCommand(optsWithSystem)

    if (cmdEnv) {
      this.sandboxManager.setEnvVars(cmdEnv)
    }

    const fullCommand = [cmd, ...args.map(arg =>
      arg.includes(" ") || arg.includes('"') || arg.includes("'")
        ? `'${arg.replace(/'/g, "'\\''")}'`
        : arg
    )].join(" ")

    const runId = options.runId ?? randomUUID().slice(0, 8)
    const timeout = options.timeout ?? 30

    if (typeof this.sandboxManager.executeBackground !== "function") {
      throw new Error(
        "Background sessions require a sandbox with executeBackground (e.g. Daytona sandbox with createSshAccess())."
      )
    }
    debugLog(`startSandboxBackground executing provider=${this.name} outputFile=${options.outputFile} runId=${runId}`)
    t = Date.now()
    const result = await this.sandboxManager.executeBackground({
      command: fullCommand,
      outputFile: options.outputFile,
      runId,
      timeout,
    })
    console.log(`[timing] executeBackground took ${Date.now() - t}ms (total startSandboxBackground ${Date.now() - t0}ms)`)
    const pid = result.pid
    debugLog(`startSandboxBackground done provider=${this.name} pid=${pid}`)

    const executionId = randomUUID()

    return {
      executionId,
      pid,
      runId,
      outputFile: options.outputFile,
      cursor: "0",
    }
  }

  /**
   * Poll a background sandbox run by reading the JSONL log file.
   * Cursor is an opaque string representing the last processed line index.
   */
  async pollSandboxBackground(
    outputFile: string,
    cursor?: string | null
  ): Promise<{
    status: "running" | "completed"
    sessionId: string | null
    events: Event[]
    cursor: string
  }> {
    if (!this.sandboxManager || !this.sandboxManager.executeCommand) {
      throw new Error("Sandbox background mode requires a sandbox with executeCommand support")
    }

    const decodeCursor = (c?: string | null) => (c ? Number(c) || 0 : 0)
    const encodeCursor = (index: number) => String(index)

    const startIndex = decodeCursor(cursor)

    const catCommand = `cat ${outputFile}`
    const result = await this.sandboxManager.executeCommand(catCommand, 30)
    const rawOutput = result.output ?? ""

    const rawLines = rawOutput.split("\n")
    debugLog(`pollSandboxBackground provider=${this.name} outputFile=${outputFile} cursor=${cursor ?? "null"} rawLines=${rawLines.length}`)
    const lines: string[] = []

    const isJsonLine = (line: string): boolean => {
      const trimmed = line.trim()
      return trimmed.startsWith("{") && trimmed.endsWith("}")
    }

    const isRereading = startIndex >= rawLines.length
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!isJsonLine(trimmed) && i === rawLines.length - 1) {
        if (!isRereading) debugLog(`background poll skipped (partial last line) [${i}]: ${trimmed.length > 400 ? trimmed.slice(0, 400) + "…" : trimmed}`)
        continue
      }
      if (isJsonLine(trimmed)) {
        lines.push(trimmed)
      } else {
        if (!isRereading) debugLog(`background poll skipped (not JSONL) [${i}]: ${trimmed.length > 400 ? trimmed.slice(0, 400) + "…" : trimmed}`)
      }
    }

    if (startIndex >= lines.length) {
      const hasContent = rawLines.some((l) => l.trim().length > 0)
      const noValidLines = lines.length === 0 && hasContent
      // Advance cursor past raw lines so we don't re-read and re-log the same content every poll.
      const nextCursor = noValidLines ? rawLines.length : lines.length
      return {
        status: noValidLines ? "completed" : "running",
        sessionId: this.sessionId,
        events: [],
        cursor: encodeCursor(nextCursor),
      }
    }

    const slice = lines.slice(startIndex)
    for (let i = 0; i < slice.length; i++) {
      const l = slice[i]
      debugLog(`raw line (background poll) [${startIndex + i}]: ${(l ?? "").length > 300 ? (l ?? "").slice(0, 300) + "…" : l ?? ""}`)
    }

    const eventsOut: Event[] = []
    let status: "running" | "completed" = "running"

    for (const line of slice) {
      const raw = this.parse(line)
      if (raw === null) {
        debugLog(`unparsed line (background poll): ${line.length > 200 ? line.slice(0, 200) + "…" : line}`)
      }
      const events = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      for (const event of events) {
        if (event.type === "session") {
          this.sessionId = event.id
        }
        if (event.type === "end") {
          status = "completed"
        }
        eventsOut.push(event)
      }
    }

    const newCursor = encodeCursor(lines.length)
    debugLog(`pollSandboxBackground result provider=${this.name} status=${status} events=${eventsOut.length} newCursor=${newCursor}`)

    return {
      status,
      sessionId: this.sessionId,
      events: eventsOut,
      cursor: newCursor,
    }
  }

  /**
   * Run the provider with a callback for each event
   */
  async runWithCallback(
    callback: (event: Event) => void | Promise<void>,
    promptOrOptions: string | RunOptions = {}
  ): Promise<void> {
    for await (const event of this.run(promptOrOptions)) {
      await callback(event)
    }
  }

  /**
   * Collect all events from a run into an array
   */
  async collectEvents(promptOrOptions: string | RunOptions = {}): Promise<Event[]> {
    const events: Event[] = []
    for await (const event of this.run(promptOrOptions)) {
      events.push(event)
    }
    return events
  }

  /**
   * Collect the full text response from a run
   */
  async collectText(promptOrOptions: string | RunOptions = {}): Promise<string> {
    let text = ""
    for await (const event of this.run(promptOrOptions)) {
      if (event.type === "token") {
        text += event.text
      }
    }
    return text
  }
}
