import type { Event } from "./events.js"

/**
 * Provider-related types and interfaces
 */

/** Supported provider names */
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

/**
 * Sandbox interface required by the SDK. Implement this yourself or use
 * adaptDaytonaSandbox() to wrap a Daytona Sandbox from @daytonaio/sdk.
 */
export interface CodeAgentSandbox {
  ensureProvider(name: ProviderName): Promise<void>
  setEnvVars(vars: Record<string, string>): void
  executeCommandStream(command: string, timeout?: number): AsyncGenerator<string, void, unknown>
  /** Optional: run a one-off command (used e.g. for Codex login). */
  executeCommand?(command: string, timeout?: number): Promise<{ exitCode: number; output: string }>
}

/** Command configuration for spawning a provider process */
export interface ProviderCommand {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

/** Options when adapting a Daytona sandbox for use with the SDK */
export interface AdaptSandboxOptions {
  /** Environment variables for CLI execution (e.g. ANTHROPIC_API_KEY) */
  env?: Record<string, string>
}

/** Options for running a provider */
export interface RunOptions {
  /** The prompt to send to the provider */
  prompt?: string
  /** Optional session ID to resume */
  sessionId?: string
  /** Whether to persist session ID to file (only for local mode) */
  persistSession?: boolean
  /** Custom session file path (only for local mode) */
  sessionFile?: string
  /** Working directory for the provider process */
  cwd?: string
  /** Environment variables to pass to the provider */
  env?: Record<string, string>
  /** Automatically install the CLI if not found (default: true) */
  autoInstall?: boolean
  /** Timeout in seconds for sandbox execution (default: 120) */
  timeout?: number
  /** Model to use (provider-specific, e.g., "openai/gpt-4o") */
  model?: string
}

/** Options for creating a provider */
export interface ProviderOptions {
  /**
   * Sandbox for secure execution. Pass a Sandbox from @daytonaio/sdk directly
   * (the SDK adapts it internally). Optional env here is used for CLI execution.
   */
  sandbox?: CodeAgentSandbox | import("@daytonaio/sdk").Sandbox

  /** Environment variables for CLI execution (e.g. when sandbox is a Daytona Sandbox) */
  env?: Record<string, string>

  /**
   * Allow running commands directly on local machine without sandbox.
   * ⚠️ DANGEROUS: Only use this if you trust the code being executed.
   */
  dangerouslyAllowLocalExecution?: boolean
}

/** Event handler callback */
export type EventHandler = (event: Event) => void | Promise<void>

/** Provider interface that all providers must implement */
export interface IProvider {
  /** Provider name */
  readonly name: ProviderName

  /** Current session ID */
  sessionId: string | null

  /** Convenience accessor for current session id */
  getSessionId(): string | null

  /** Get the command to spawn the provider */
  getCommand(options?: RunOptions): ProviderCommand

  /** Parse a line of output into one or more events */
  parse(line: string): Event | Event[] | null

  /** Run the provider and emit events */
  run(options?: RunOptions): AsyncGenerator<Event, void, unknown>
}
