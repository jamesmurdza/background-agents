import { spawn } from "node:child_process"
import * as readline from "node:readline"
import type { Event, IProvider, ProviderCommand, ProviderName, RunOptions } from "../types/index.js"
import { getDefaultSessionPath, loadSession, storeSession } from "../utils/session.js"
import { ensureCliInstalled } from "../utils/install.js"
import { SandboxManager } from "../sandbox/index.js"

/**
 * Abstract base class for AI coding agent providers
 */
export abstract class Provider implements IProvider {
  abstract readonly name: ProviderName

  sessionId: string | null = null

  /** Sandbox manager instance (reused across runs) */
  private sandboxManager: SandboxManager | null = null

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
    const mode = options.mode ?? "sandbox"

    if (mode === "local") {
      yield* this.runLocal(options)
    } else {
      yield* this.runSandbox(options)
    }
  }

  /**
   * Run in a secure Daytona sandbox (default)
   */
  private async *runSandbox(options: RunOptions): AsyncGenerator<Event, void, unknown> {
    // Create or reuse sandbox manager
    if (!this.sandboxManager) {
      this.sandboxManager = new SandboxManager(options.sandbox)
    }

    // Ensure CLI is installed in sandbox (auto-install by default in sandbox mode)
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
    const fullCommand = [cmd, ...args.map(arg =>
      arg.includes(" ") ? `"${arg}"` : arg
    )].join(" ")

    // Set command-specific env vars
    if (cmdEnv) {
      await this.sandboxManager.setEnvVars(cmdEnv)
    }

    // Execute and stream output
    for await (const line of this.sandboxManager.executeCommandStream(fullCommand)) {
      const event = this.parse(line)
      if (!event) continue

      if (event.type === "session") {
        this.sessionId = event.id
        // In sandbox mode, we store session in sandbox, not locally
        yield event
        continue
      }

      yield event
    }
  }

  /**
   * Run directly on local machine (use with caution)
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

  /**
   * Destroy the sandbox (cleanup resources)
   */
  async destroySandbox(): Promise<void> {
    if (this.sandboxManager) {
      await this.sandboxManager.destroy()
      this.sandboxManager = null
    }
  }
}
