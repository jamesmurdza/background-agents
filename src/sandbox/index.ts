import { Daytona, Sandbox, PtyHandle } from "@daytonaio/sdk"
import type { ProviderName, SandboxConfig } from "../types/index.js"
import { getPackageName } from "../utils/install.js"

// Re-export SandboxConfig from types
export type { SandboxConfig } from "../types/index.js"

/**
 * Manages a Daytona sandbox for secure CLI execution
 */
export class SandboxManager {
  private daytona: Daytona
  private _sandbox: Sandbox | null = null
  private config: SandboxConfig
  private envVars: Record<string, string> = {}

  constructor(config: SandboxConfig = {}) {
    this.config = config
    this.daytona = new Daytona({
      apiKey: config.apiKey,
      serverUrl: config.serverUrl,
      target: config.target,
    })
    if (config.env) {
      this.envVars = { ...config.env }
    }
  }

  /**
   * Get the underlying Daytona Sandbox instance
   */
  get sandbox(): Sandbox | null {
    return this._sandbox
  }

  /**
   * Create the sandbox instance
   */
  async create(): Promise<Sandbox> {
    if (!this._sandbox) {
      this._sandbox = await this.daytona.create({
        language: "typescript",
        envVars: this.config.env,
        autoStopInterval: this.config.autoStopTimeout,
      })
    }
    return this._sandbox
  }

  /**
   * Install a provider CLI in the sandbox
   */
  async installProvider(name: ProviderName): Promise<boolean> {
    const sandbox = await this.create()
    const packageName = getPackageName(name)

    try {
      const result = await sandbox.process.executeCommand(
        `npm install -g ${packageName}`,
        undefined,
        undefined,
        120
      )
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * Check if a provider CLI is installed in the sandbox
   */
  async isProviderInstalled(name: ProviderName): Promise<boolean> {
    const sandbox = await this.create()

    try {
      const result = await sandbox.process.executeCommand(`which ${name}`)
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * Ensure a provider CLI is installed, installing if necessary
   */
  async ensureProvider(name: ProviderName): Promise<void> {
    const installed = await this.isProviderInstalled(name)
    if (!installed) {
      console.log(`Installing ${name} CLI in sandbox...`)
      const success = await this.installProvider(name)
      if (!success) {
        throw new Error(`Failed to install ${name} CLI in sandbox`)
      }
      console.log(`Installed ${name} CLI`)
    }
  }

  /**
   * Execute a command in the sandbox (blocking, returns full output)
   */
  async executeCommand(
    command: string,
    timeout: number = 60
  ): Promise<{ exitCode: number; output: string }> {
    const sandbox = await this.create()

    // Build env string prefix
    const envPrefix = Object.entries(this.envVars)
      .map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`)
      .join(" ")

    const fullCommand = envPrefix ? `${envPrefix} ${command}` : command

    const result = await sandbox.process.executeCommand(
      fullCommand,
      undefined,
      undefined,
      timeout
    )

    return {
      exitCode: result.exitCode ?? 0,
      output: result.result ?? "",
    }
  }

  /**
   * Strip ANSI escape codes and terminal control sequences from text
   */
  private stripAnsi(text: string): string {
    // Remove ANSI escape sequences (colors, cursor movement, etc.)
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]|\r/g, "")
  }

  /**
   * Check if a line looks like valid JSON (for filtering PTY noise)
   */
  private isJsonLine(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.startsWith("{") && trimmed.endsWith("}")
  }

  /**
   * Execute a command via PTY and stream output line by line in real-time
   */
  async *executeCommandStream(
    command: string,
    _timeout: number = 120
  ): AsyncGenerator<string, void, unknown> {
    const sandbox = await this.create()

    // Build env export commands
    const envExports = Object.entries(this.envVars)
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join("; ")

    // Run under `timeout` to avoid hanging CLIs (e.g. opencode run)
    const timedCommand =
      _timeout > 0
        ? `timeout ${_timeout}s ${command}`
        : command

    const fullCommand = envExports ? `${envExports}; ${timedCommand}` : timedCommand

    // Buffer for accumulating data and extracting lines
    let buffer = ""
    const lineQueue: string[] = []
    let resolveNext: ((value: IteratorResult<string, void>) => void) | null = null
    let ptyDone = false
    let ptyHandle: PtyHandle | null = null

    // Create PTY session with streaming output
    const ptyId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ptyHandle = await sandbox.process.createPty({
      id: ptyId,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        buffer += text

        // Extract complete lines
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? "" // Keep incomplete line in buffer

        for (const line of lines) {
          // Strip ANSI codes and trim
          const cleaned = this.stripAnsi(line).trim()

          // Only yield lines that look like JSON (filter out shell prompts, etc.)
          if (cleaned && this.isJsonLine(cleaned)) {
            if (resolveNext) {
              resolveNext({ value: cleaned, done: false })
              resolveNext = null
            } else {
              lineQueue.push(cleaned)
            }
          }
        }
      },
    })

    try {
      await ptyHandle.waitForConnection()

      // Send the command
      await ptyHandle.sendInput(`${fullCommand}\n`)

      // Send exit to close the PTY when command completes
      await ptyHandle.sendInput("exit\n")

      // Wait for PTY to complete in background
      const waitPromise = ptyHandle.wait().then(() => {
        ptyDone = true
        // Flush remaining buffer - check if it's JSON
        const cleaned = this.stripAnsi(buffer).trim()
        if (cleaned && this.isJsonLine(cleaned)) {
          if (resolveNext) {
            resolveNext({ value: cleaned, done: false })
            resolveNext = null
          } else {
            lineQueue.push(cleaned)
          }
        }
        // Signal done
        if (resolveNext) {
          resolveNext({ value: undefined, done: true })
          resolveNext = null
        }
      })

      // Yield lines as they come
      while (true) {
        if (lineQueue.length > 0) {
          yield lineQueue.shift()!
        } else if (ptyDone) {
          break
        } else {
          // Wait for next line
          const result = await new Promise<IteratorResult<string, void>>((resolve) => {
            resolveNext = resolve
            // Check again in case something was added
            if (lineQueue.length > 0) {
              resolve({ value: lineQueue.shift()!, done: false })
              resolveNext = null
            } else if (ptyDone) {
              resolve({ value: undefined, done: true })
              resolveNext = null
            }
          })
          if (result.done) break
          yield result.value
        }
      }

      await waitPromise
    } finally {
      if (ptyHandle) {
        await ptyHandle.disconnect()
      }
    }
  }

  /**
   * Set environment variable for future commands
   */
  setEnv(name: string, value: string): void {
    this.envVars[name] = value
  }

  /**
   * Set multiple environment variables
   */
  setEnvVars(vars: Record<string, string>): void {
    Object.assign(this.envVars, vars)
  }

  /**
   * Cleanup and destroy the sandbox
   */
  async destroy(): Promise<void> {
    if (this._sandbox) {
      try {
        await this._sandbox.delete()
      } catch {
        // Ignore errors when deleting sandbox
      }
      this._sandbox = null
    }
  }
}

/**
 * Create a sandbox manager with the given configuration
 */
export function createSandbox(config?: SandboxConfig): SandboxManager {
  return new SandboxManager(config)
}
