/**
 * Kilo CLI output parser
 *
 * Pure function for parsing Kilo CLI JSON output.
 * Kilo is a fork of OpenCode with an identical JSONL schema today,
 * but this parser is kept separate so it can evolve independently.
 *
 * Note: Kilo emits "reasoning" events for thinking blocks; these are
 * internal and must NOT be forwarded to the UI.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, normalizeToolName } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Raw event types from Kilo's JSON stream
 */
interface KiloStepStart {
  type: "step_start"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "step-start"
  }
}

interface KiloText {
  type: "text"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "text"
    text?: string
  }
}

interface KiloToolCall {
  type: "tool_call"
  sessionID: string
  part?: {
    id: string
    type: "tool-call"
    tool?: string
    args?: unknown
  }
}

interface KiloToolUse {
  type: "tool_use"
  sessionID: string
  part?: {
    id: string
    tool?: string
    state?: { status: string; input?: unknown }
  }
}

interface KiloToolResult {
  type: "tool_result"
  sessionID: string
  part?: {
    id: string
    type: "tool-result"
  }
}

interface KiloStepFinish {
  type: "step_finish"
  sessionID: string
  part?: {
    id: string
    type: "step-finish"
    reason: string
  }
}

interface KiloError {
  type: "error"
  sessionID: string
  error?: {
    name: string
    data?: {
      message: string
    }
  }
}

interface KiloReasoning {
  type: "reasoning"
  sessionID: string
  part?: {
    type: "reasoning"
    text?: string
  }
}

type KiloEvent =
  | KiloStepStart
  | KiloText
  | KiloToolCall
  | KiloToolUse
  | KiloToolResult
  | KiloStepFinish
  | KiloError
  | KiloReasoning

/**
 * Parse a line of Kilo CLI output into event(s).
 *
 * Uses context.sessionId to track if session event was already emitted.
 * Reasoning events are intentionally dropped — only user-visible text is forwarded.
 */
export function parseKiloLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<KiloEvent>(line)
  if (!json) {
    return null
  }

  // Step start - session initialization
  if (json.type === "step_start") {
    // Kilo can emit multiple step_start lines for the same session; only emit once
    if (context.sessionId === json.sessionID) return null
    context.sessionId = json.sessionID
    return { type: "session", id: json.sessionID }
  }

  // Text content - the actual response
  if (json.type === "text") {
    if (json.part?.type === "text" && json.part.text) {
      return { type: "token", text: json.part.text }
    }
    return null
  }

  // Reasoning - internal thinking blocks, never surface to user
  if (json.type === "reasoning") {
    return null
  }

  // Tool call start
  if (json.type === "tool_call") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    return createToolStartEvent(normalized, json.part?.args, toolMappings)
  }

  // Tool use (stream-json: emitted when tool completes with full state)
  if (json.type === "tool_use") {
    const toolName = (json.part?.tool || "unknown").toLowerCase()
    const normalized = normalizeToolName(toolName, toolMappings)
    const raw = json.part as { state?: { status?: string; input?: unknown; output?: string } } | undefined
    const startEvent = createToolStartEvent(normalized, raw?.state?.input, toolMappings)

    // If the tool already completed (state.output is present), emit tool_end inline.
    // This is the common case for Kilo: tool_use carries the full result.
    const rawOutput = raw?.state?.output
    if (typeof rawOutput === "string" && rawOutput.trim()) {
      return [startEvent, { type: "tool_end", output: rawOutput.trim() }]
    }
    return startEvent
  }

  // Tool result - tool completed (streaming / in-progress path, no output here)
  if (json.type === "tool_result") {
    return { type: "tool_end" }
  }

  // Step finish - emit end only when run actually stops
  if (json.type === "step_finish") {
    if (json.part?.reason === "stop") return { type: "end" }
    return null
  }

  // Error event - emit as end with error
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json, "kilo") }
  }

  return null
}
