/**
 * Sandbox and Provider Types
 */

/**
 * Supported agent names.
 * Used by ensureProvider() to install the correct CLI.
 */
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

/**
 * Options for starting a background command that writes to a log file.
 */
export interface ExecuteBackgroundOptions {
  /** Full command line to run (stdout/stderr should be appended to outputFile). */
  command: string
  /** Path in sandbox to append output to (e.g. /tmp/codeagent-<id>/0.jsonl). */
  outputFile: string
  /** Unique run id (used for logging; PID is returned from executeBackground). */
  runId: string
  /** Timeout in minutes */
  timeout?: number
}

/**
 * Sandbox interface required by the SDK.
 *
 * Implement this yourself or use adaptDaytonaSandbox() to wrap
 * a Daytona Sandbox from @daytonaio/sdk.
 */
export interface CodeAgentSandbox {
  /** Install the provider CLI if not already installed */
  ensureProvider(name: ProviderName): Promise<void>

  /** Set environment variables for subsequent commands */
  setEnvVars(vars: Record<string, string>): void

  /** Set session-level env vars (persistent across runs) */
  setSessionEnvVars?(vars: Record<string, string>): void

  /** Set run-level env vars (cleared after each run) */
  setRunEnvVars?(vars: Record<string, string>): void

  /** Clear run-level env vars */
  clearRunEnvVars?(): void

  /** Run a one-off command and return the result */
  executeCommand?(
    command: string,
    timeout?: number
  ): Promise<{ exitCode: number; output: string }>

  /**
   * Start a command in the background and return its PID immediately.
   * The sandbox must run the command with stdout/stderr >> outputFile.
   */
  executeBackground?(options: ExecuteBackgroundOptions): Promise<{ pid: number }>

  /** Kill a background process by PID */
  killBackgroundProcess?(pid: number, processName?: string): Promise<void>

  /** Optimized poll: reads meta, output, and done status in fewer commands */
  pollBackgroundState?(sessionDir: string): Promise<{
    meta: string | null
    output: string
    done: boolean
  } | null>
}

/**
 * Options when adapting a Daytona sandbox for use with the SDK.
 */
export interface AdaptSandboxOptions {
  /** Environment variables for CLI execution */
  env?: Record<string, string>
}
