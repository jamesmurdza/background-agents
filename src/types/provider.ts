import type { Event } from "./events.js"

/**
 * Provider-related types and interfaces
 */

/** Supported provider names */
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

/** Execution mode for providers */
export type ExecutionMode = "sandbox" | "local"

/** Command configuration for spawning a provider process */
export interface ProviderCommand {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Sandbox configuration options
 */
export interface SandboxConfig {
  /** Daytona API key (defaults to DAYTONA_API_KEY env var) */
  apiKey?: string
  /** Daytona server URL (defaults to DAYTONA_SERVER_URL env var) */
  serverUrl?: string
  /** Target region for sandbox */
  target?: string
  /** Auto-stop timeout in seconds (0 to disable) */
  autoStopTimeout?: number
  /** Custom environment variables for the sandbox */
  env?: Record<string, string>
}

/** Options for running a provider */
export interface RunOptions {
  /** The prompt to send to the provider */
  prompt?: string
  /** Optional session ID to resume */
  sessionId?: string
  /** Whether to persist session ID to file */
  persistSession?: boolean
  /** Custom session file path */
  sessionFile?: string
  /** Working directory for the provider process */
  cwd?: string
  /** Environment variables to pass to the provider */
  env?: Record<string, string>
  /** Automatically install the CLI if not found (default: true for sandbox, false for local) */
  autoInstall?: boolean
  /**
   * Execution mode (default: "sandbox")
   * - "sandbox": Run in a secure Daytona sandbox (recommended)
   * - "local": Run directly on the local machine (use with caution)
   */
  mode?: ExecutionMode
  /** Sandbox configuration (only used when mode is "sandbox") */
  sandbox?: SandboxConfig
}

/** Event handler callback */
export type EventHandler = (event: Event) => void | Promise<void>

/** Provider interface that all providers must implement */
export interface IProvider {
  /** Provider name */
  readonly name: ProviderName

  /** Current session ID */
  sessionId: string | null

  /** Get the command to spawn the provider */
  getCommand(options?: RunOptions): ProviderCommand

  /** Parse a line of output into an event */
  parse(line: string): Event | null

  /** Run the provider and emit events */
  run(options?: RunOptions): AsyncGenerator<Event, void, unknown>
}
