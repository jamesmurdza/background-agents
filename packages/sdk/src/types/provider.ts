/**
 * Sandbox and Provider Types
 */

import type { SandboxJobs } from "@background-agents/sandbox-jobs"

/**
 * Supported agent names.
 * Used by ensureProvider() to install the correct CLI.
 */
export type ProviderName = "claude" | "codex" | "commandcode" | "copilot" | "droid" | "eliza" | "goose" | "kilo" | "kimi" | "opencode" | "gemini" | "pi"

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

  /**
   * Read-only snapshot of the effective session + run + invocation environment.
   * Context-aware adapters should implement this with the same merge used by
   * command execution and jobs. Values may contain credentials; never log them.
   */
  getEffectiveEnv?(invocationEnv?: Record<string, string>): Record<string, string>

  /**
   * Inspect an already-installed managed provider runtime without installing it
   * or changing shared environment. Return undefined for unmanaged providers to
   * use contextual PATH discovery. Missing managed runtimes must not fall back
   * to a different global executable.
   */
  readProviderVersion?(
    name: ProviderName,
    timeout: number,
    context: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ exitCode: number; output: string } | undefined>

  /** Run a one-off command and return the result */
  executeCommand?(
    command: string,
    timeout?: number
  ): Promise<{ exitCode: number; output: string }>

  /** Optional read-only command with the same env/cwd merge as a launched job. */
  executeCommandInContext?(
    command: string,
    timeout: number,
    context: { cwd?: string; env?: Record<string, string> }
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
