/**
 * Background Session Types
 */

import type { Event } from "../types/events.js"

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
 * Session metadata stored in sandbox
 */
export interface SessionMeta {
  currentTurn: number
  cursor: number
  rawCursor?: number
  pid?: number
  runId?: string
  outputFile?: string
  sawEnd?: boolean
  startedAt?: string
  provider?: string
  sessionId?: string | null
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
}
