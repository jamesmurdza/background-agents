import { spawn } from "node:child_process"
import * as readline from "node:readline"
import type { Event, IProvider, ProviderCommand, ProviderName, RunOptions, ProviderOptions, RunDefaults } from "../types/index.js"
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
        "  import { createProvider } from 'coding-agents'\n" +
        "  const daytona = new Daytona({ apiKey: '...' })\n" +
        "  const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: '...' } })\n" +
        "  const provider = createProvider('claude', { sandbox, env: { ANTHROPIC_API_KEY: '...' } })\n\n" +
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
   * Run the provider and yield events. Pass a prompt string or full RunOptions.
   * When created via createSession, runDefaults are merged in (e.g. model, timeout).
   */
  async *run(promptOrOptions: string | RunOptions = {}): AsyncGenerator<Event, void, unknown> {
    const options: RunOptions =
      typeof promptOrOptions === "string"
        ? { ...this._runDefaults, prompt: promptOrOptions }
        : { ...this._runDefaults, ...promptOrOptions }
    if (this.sandboxManager) {
      yield* this.runSandbox(options)
    } else if (this.allowLocalExecution) {
      yield* this.runLocal(options)
    } else {
      throw new Error("No execution mode configured")
    }
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
    await this.sandboxManager.ensureProvider(this.name)
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

    let pendingToolEnd = false
    for await (const line of this.sandboxManager.executeCommandStream(fullCommand, timeout)) {
      const raw = this.parse(line)
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

    for await (const line of rl) {
      const raw = this.parse(line)
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
        if (code && code !== 0) {
          reject(new Error(`Provider process exited with code ${code}`))
        } else {
          resolve()
        }
      })
      proc.on("error", reject)
    })
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
