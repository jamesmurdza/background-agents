/**
 * Sandbox and Provider Types
 */

import type { SandboxJobs } from "@background-agents/sandbox-jobs"

/**
 * Supported agent names.
 * Used by ensureProvider() to install the correct CLI.
 */
export type ProviderName = "claude" | "codex" | "copilot" | "eliza" | "goose" | "kilo" | "opencode" | "gemini" | "pi"

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
   * Long-running-process runner. Background sessions launch one job per turn
   * and observe it via the sandbox filesystem. The Daytona adapter wires this
   * to @background-agents/sandbox-jobs (with session env injected); custom
   * sandboxes may provide their own implementation.
   */
  jobs?: SandboxJobs
}

/**
 * Options when adapting a Daytona sandbox for use with the SDK.
 */
export interface AdaptSandboxOptions {
  /** Environment variables for CLI execution */
  env?: Record<string, string>
}
