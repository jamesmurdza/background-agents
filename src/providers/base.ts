import { spawn } from "node:child_process"
import * as readline from "node:readline"
import type { Event, IProvider, ProviderCommand, ProviderName, RunOptions, ProviderOptions } from "../types/index.js"
import { getDefaultSessionPath, loadSession, storeSession } from "../utils/session.js"
import { ensureCliInstalled } from "../utils/install.js"
import type { SandboxManager } from "../sandbox/index.js"

/**
 * Abstract base class for AI coding agent providers
 */
export abstract class Provider implements IProvider {
  abstract readonly name: ProviderName

  sessionId: string | null = null

  /** Sandbox manager for secure execution */
  protected sandboxManager: SandboxManager | null = null

  /** Whether local execution is allowed */
  protected allowLocalExecution: boolean = false

  constructor(options: ProviderOptions = {}) {
    if (options.sandbox) {
      this.sandboxManager = options.sandbox
    } else if (options.dangerouslyAllowLocalExecution) {
      this.allowLocalExecution = true
    } else {
      throw new Error(
        "Provider requires either a sandbox or dangerouslyAllowLocalExecution: true. " +
        "For secure execution, create a sandbox first:\n\n" +
        "  const sandbox = createSandbox({ apiKey: '...' })\n" +
        "  await sandbox.create()\n" +
        "  const provider = new ClaudeProvider({ sandbox })\n\n" +
        "For local execution (dangerous), use:\n\n" +
        "  const provider = new ClaudeProvider({ dangerouslyAllowLocalExecution: true })"
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
  abstract parse(line: string): Event | null

  /**
   * Run the provider and yield events as an async generator
   */
  async *run(options: RunOptions = {}): AsyncGenerator<Event, void, unknown> {
    if (this.sandboxManager) {
      yield* this.runSandbox(options)
    } else if (this.allowLocalExecution) {
      yield* this.runLocal(options)
    } else {
      throw new Error("No execution mode configured")
    }
  }

  /**
   * Run in a secure Daytona sandbox
   */
  private async *runSandbox(options: RunOptions): AsyncGenerator<Event, void, unknown> {
    if (!this.sandboxManager) {
      throw new Error("Sandbox manager not configured")
    }

    // Ensure CLI is installed in sandbox
    const autoInstall = options.autoInstall ?? true
    if (autoInstall) {
      await this.sandboxManager.ensureProvider(this.name)
    }

    // Set environment variables
    if (options.env) {
      await this.sandboxManager.setEnvVars(options.env)
    }

    // Build the command
    const { cmd, args, env: cmdEnv } = this.getCommand(options)

    // Set command-specific env vars
    if (cmdEnv) {
      await this.sandboxManager.setEnvVars(cmdEnv)
    }

    // Build full command string
    const fullCommand = [cmd, ...args.map(arg =>
      arg.includes(" ") || arg.includes('"') || arg.includes("'")
        ? `'${arg.replace(/'/g, "'\\''")}'`
        : arg
    )].join(" ")

    // Execute and stream output
    for await (const line of this.sandboxManager.executeCommandStream(fullCommand)) {
      const event = this.parse(line)
      if (!event) continue

      if (event.type === "session") {
        this.sessionId = event.id
        yield event
        continue
      }

      yield event
    }
  }

  /**
   * Run directly on local machine (dangerous - use with caution)
   */
  private async *runLocal(options: RunOptions): AsyncGenerator<Event, void, unknown> {
    // Ensure CLI is installed locally
    ensureCliInstalled(this.name, options.autoInstall ?? false)

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

    for await (const line of rl) {
      const event = this.parse(line)
      if (!event) continue

      if (event.type === "session") {
        this.sessionId = event.id
        if (options.persistSession !== false) {
          storeSession(sessionFile, event.id)
        }
        yield event
        continue
      }

      yield event
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
    options: RunOptions = {}
  ): Promise<void> {
    for await (const event of this.run(options)) {
      await callback(event)
    }
  }

  /**
   * Collect all events from a run into an array
   */
  async collectEvents(options: RunOptions = {}): Promise<Event[]> {
    const events: Event[] = []
    for await (const event of this.run(options)) {
      events.push(event)
    }
    return events
  }

  /**
   * Collect the full text response from a run
   */
  async collectText(options: RunOptions = {}): Promise<string> {
    let text = ""
    for await (const event of this.run(options)) {
      if (event.type === "token") {
        text += event.text
      }
    }
    return text
  }
}
