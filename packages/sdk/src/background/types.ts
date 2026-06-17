/**
 * Background Session Types
 */

import type { Event } from "../types/events"

/**
 * Run phase for background sessions
 */
export type BackgroundRunPhase = "idle" | "starting" | "running" | "stopped"

/**
 * Handle returned when starting a turn
 */
export interface TurnHandle {
  executionId: string
  pid: number
  outputFile: string
}

/**
 * Result of polling for events
 */
export interface PollResult {
  sessionId: string | null
  events: Event[]
  cursor: string
  running: boolean
  runPhase: BackgroundRunPhase
}

/**
 * Conversation metadata stored at `<sessionDir>/meta.json`.
 *
 * This is the durable, cold-reconnect state for the *conversation* (turns,
 * agent session id, provider). Per-process state (output, exit code, pid) lives
 * in the job directory and is owned by @background-agents/sandbox-jobs — not
 * duplicated here.
 */
export interface SessionMeta {
  /** Monotonic turn counter (cosmetic; each turn is an independent job). */
  currentTurn: number
  /** Agent name, so a cold caller can reattach without knowing it. */
  provider?: string
  /** Agent's own session id (for resume), captured from the event stream. */
  sessionId?: string | null
  /** Current turn's job id — the key to reattach to its process. */
  jobId?: string
  /** Current turn's start time (ISO); used for the startup grace window. */
  startedAt?: string
  /** The current turn was user-cancelled (suppresses crash synthesis). */
  cancelled?: boolean
}

/**
 * A single message from previous conversation history.
 * Used to inject context when switching agents or forking chats.
 */
export interface HistoryMessage {
  readonly role: "user" | "assistant"
  readonly content: string
}

/**
 * Options for starting a turn
 */
export interface StartOptions {
  prompt: string
  model?: string
  sessionId?: string
  timeout?: number
  systemPrompt?: string
  env?: Record<string, string>
  /** Working directory for the agent process */
  cwd?: string
  /** Previous conversation history to inject as context for this turn. */
  history?: readonly HistoryMessage[]
  /** When true, agent should use extended thinking / plan mode */
  planMode?: boolean
}
