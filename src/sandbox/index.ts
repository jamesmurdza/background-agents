import { Daytona, Sandbox } from "@daytonaio/sdk"
import type { ProviderName, SandboxConfig } from "../types/index.js"
import { getPackageName } from "../utils/install.js"

// Re-export SandboxConfig from types
export type { SandboxConfig } from "../types/index.js"

/**
 * Session command execution options
 */
export interface SessionCommandOptions {
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Command timeout in milliseconds */
  timeout?: number
  /** Run command asynchronously */
  async?: boolean
}

/**
 * Manages a Daytona sandbox for secure CLI execution
 */
export class SandboxManager {
  private daytona: Daytona
  private sandbox: Sandbox | null = null
  private sessionId: string | null = null
  private config: SandboxConfig

  constructor(config: SandboxConfig = {}) {
    this.config = config
    this.daytona = new Daytona({
      apiKey: config.apiKey,
      serverUrl: config.serverUrl,
      target: config.target,
    })
  }

  /**
   * Create or get the sandbox instance
   */
  async getSandbox(): Promise<Sandbox> {
    if (!this.sandbox) {
      this.sandbox = await this.daytona.create({
        language: "typescript",
        envVars: this.config.env,
        autoStopInterval: this.config.autoStopTimeout,
      })
    }
    return this.sandbox
  }

  /**
   * Install a provider CLI in the sandbox
   */
  async installProvider(name: ProviderName): Promise<boolean> {
    const sandbox = await this.getSandbox()
    const packageName = getPackageName(name)

    try {
      const result = await sandbox.process.executeCommand(
        `npm install -g ${packageName}`,
        undefined, // cwd
        undefined, // env
        120 // timeout in seconds
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
    const sandbox = await this.getSandbox()

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
      const success = await this.installProvider(name)
      if (!success) {
        throw new Error(`Failed to install ${name} CLI in sandbox`)
      }
    }
  }

  /**
   * Create a session for running commands
   */
  async createSession(sessionId?: string): Promise<string> {
    const sandbox = await this.getSandbox()
    const id = sessionId ?? `session-${Date.now()}`

    await sandbox.process.createSession(id)
    this.sessionId = id

    return id
  }

  /**
   * Get or create the current session
   */
  async getSession(): Promise<string> {
    if (!this.sessionId) {
      return this.createSession()
    }
    return this.sessionId
  }

  /**
   * Execute a command in the sandbox session
   */
  async executeCommand(
    command: string,
    _options: SessionCommandOptions = {}
  ): Promise<{ exitCode: number; output: string }> {
    const sandbox = await this.getSandbox()
    const sessionId = await this.getSession()

    const result = await sandbox.process.executeSessionCommand(sessionId, {
      command,
      runAsync: false,
    })

    // Get the command output
    const logs = await sandbox.process.getSessionCommandLogs(
      sessionId,
      result.cmdId
    )

    return {
      exitCode: result.exitCode ?? 0,
      output: logs.output ?? logs.stdout ?? "",
    }
  }

  /**
   * Execute a command and stream output line by line
   */
  async *executeCommandStream(
    command: string,
    _options: SessionCommandOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const sandbox = await this.getSandbox()
    const sessionId = await this.getSession()

    // Execute command asynchronously
    const result = await sandbox.process.executeSessionCommand(sessionId, {
      command,
      runAsync: true,
    })

    // Stream logs
    let lastOutput = ""
    let completed = false

    while (!completed) {
      const logs = await sandbox.process.getSessionCommandLogs(
        sessionId,
        result.cmdId
      )

      const currentOutput = logs.output ?? logs.stdout ?? ""

      if (currentOutput.length > lastOutput.length) {
        const newContent = currentOutput.slice(lastOutput.length)
        const lines = newContent.split("\n")

        for (const line of lines) {
          if (line.trim()) {
            yield line
          }
        }

        lastOutput = currentOutput
      }

      // Check if command completed
      const cmdInfo = await sandbox.process.getSessionCommand(
        sessionId,
        result.cmdId
      )

      if (cmdInfo.exitCode !== undefined) {
        completed = true
      } else {
        // Small delay before polling again
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  /**
   * Set environment variable in the sandbox
   */
  async setEnv(name: string, value: string): Promise<void> {
    await this.executeCommand(`export ${name}="${value}"`)
  }

  /**
   * Set multiple environment variables
   */
  async setEnvVars(vars: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(vars)) {
      await this.setEnv(name, value)
    }
  }

  /**
   * Delete the current session
   */
  async deleteSession(): Promise<void> {
    if (this.sessionId && this.sandbox) {
      try {
        await this.sandbox.process.deleteSession(this.sessionId)
      } catch {
        // Ignore errors when deleting session
      }
      this.sessionId = null
    }
  }

  /**
   * Cleanup and destroy the sandbox
   */
  async destroy(): Promise<void> {
    await this.deleteSession()

    if (this.sandbox) {
      try {
        await this.sandbox.delete()
      } catch {
        // Ignore errors when deleting sandbox
      }
      this.sandbox = null
    }
  }
}

/**
 * Create a sandbox manager with the given configuration
 */
export function createSandbox(config?: SandboxConfig): SandboxManager {
  return new SandboxManager(config)
}
