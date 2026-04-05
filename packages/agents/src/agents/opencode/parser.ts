/**
 * OpenCode CLI output parser
 *
 * Pure function for parsing OpenCode CLI JSON output.
 * Note: OpenCode requires stateful parsing to track session ID.
 */

import type { Event } from "../../types/events.js"
import type { ParseContext } from "../../core/agent.js"
import { createToolStartEvent, normalizeToolName } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"

/**
 * Raw event types from OpenCode's JSON stream
 */
interface OpenCodeStepStart {
  type: "step_start"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "step-start"
  }
}

interface OpenCodeText {
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

interface OpenCodeToolCall {
  type: "tool_call"
  sessionID: string
  part?: {
    id: string
    type: "tool-call"
    tool?: string
    args?: unknown
  }
}

interface OpenCodeToolUse {
  type: "tool_use"
  sessionID: string
  part?: {
    id: string
    tool?: string
    state?: { status: string; input?: unknown }
  }
}

interface OpenCodeToolResult {
  type: "tool_result"
  sessionID: string
  part?: {
    id: string
    type: "tool-result"
  }
}

interface OpenCodeStepFinish {
  type: "step_finish"
  sessionID: string
  part?: {
    id: string
    type: "step-finish"
    reason: string
  }
}

interface OpenCodeError {
  type: "error"
  sessionID: string
  error?: {
    name: string
    data?: {
      message: string
    }
  }
}

type OpenCodeEvent =
  | OpenCodeStepStart
  | OpenCodeText
  | OpenCodeToolCall
  | OpenCodeToolUse
  | OpenCodeToolResult
  | OpenCodeStepFinish
  | OpenCodeError

/**
 * Parse a line of OpenCode CLI output into event(s).
 *
 * Uses context.state.seenSessionId to track if session event was already emitted.
 */
export function parseOpencodeLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<OpenCodeEvent>(line)
  if (!json) {
    return null
  }

  // Step start - session initialization
  if (json.type === "step_start") {
    // OpenCode can emit multiple step_start lines for the same session; only emit once
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
    // This is the common case for OpenCode: tool_use carries the full result.
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
    const errorMsg =
      json.error?.data?.message || json.error?.name || "Unknown error"
    return { type: "end", error: errorMsg }
  }

  return null
}
