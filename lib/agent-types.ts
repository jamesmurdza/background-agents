/**
 * Types for the background-agents SDK integration
 * These types mirror the SDK's internal types for type safety
 */

import type { ProviderName } from "./types"

// =============================================================================
// Session Options
// =============================================================================

export interface SessionOptions {
  sandbox?: unknown // Daytona sandbox instance
  env?: Record<string, string>
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
}

export interface BackgroundSessionOptions extends SessionOptions {
  /**
   * Path to the JSONL log file inside the sandbox where the provider CLI
   * will append its stream-json events.
   */
  outputFile: string
}

// =============================================================================
// Execution Results
// =============================================================================

export interface StartResult {
  executionId: string
  pid: number
  outputFile: string
  cursor: string
}

export interface PollResult {
  status: "running" | "completed"
  sessionId: string | null
  events: AgentEvent[]
  cursor: string
}

// =============================================================================
// Agent Events (from SDK)
// =============================================================================

export interface SessionEvent {
  type: "session"
  id: string
}

export interface TokenEvent {
  type: "token"
  text: string
}

export interface ToolStartEvent {
  type: "tool_start"
  name: string
  input?: unknown
}

export interface ToolDeltaEvent {
  type: "tool_delta"
  text: string
}

export interface ToolEndEvent {
  type: "tool_end"
  output?: string
}

export interface EndEvent {
  type: "end"
}

export type AgentEvent =
  | SessionEvent
  | TokenEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolEndEvent
  | EndEvent

// =============================================================================
// Background Session Interface
// =============================================================================

export interface BackgroundSession {
  /**
   * Start a background run with the given prompt. Returns execution metadata
   * and the initial cursor for polling.
   */
  start(prompt: string, options?: Omit<SessionOptions, "outputFile">): Promise<StartResult>

  /**
   * Poll for new events since the last cursor. Events have the same shape
   * as those yielded by session.run().
   */
  poll(cursor?: string | null): Promise<PollResult>
}

// =============================================================================
// Agent Service Options
// =============================================================================

export interface AgentServiceOptions {
  provider: ProviderName
  sandbox: unknown // Daytona sandbox instance
  model?: string
  sessionId?: string
  env: Record<string, string>
  outputFile: string
  timeout?: number
}

// =============================================================================
// Decrypted Credentials
// =============================================================================

export interface DecryptedCredentials {
  anthropicApiKey?: string
  anthropicAuthToken?: string
  anthropicAuthType: string
  openaiApiKey?: string
}
