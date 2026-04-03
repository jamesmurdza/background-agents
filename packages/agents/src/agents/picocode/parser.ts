/**
 * Picocode CLI output parser
 *
 * Parses Picocode CLI output. Since Picocode doesn't have native JSON output,
 * we use RUST_LOG=picocode=trace to capture structured tracing logs in JSON format.
 *
 * The tracing-subscriber JSON format produces lines like:
 * {"timestamp":"...","level":"INFO","target":"picocode","fields":{"message":"..."}}
 */

import type { Event } from "../../types/events.js"
import type { ParseContext } from "../../core/agent.js"
import { createToolStartEvent, normalizeToolName } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"

/**
 * Tracing JSON log format from tracing-subscriber
 */
interface TracingLogLine {
  timestamp?: string
  level?: string
  target?: string
  message?: string
  fields?: {
    message?: string
    tool_name?: string
    tool_args?: unknown
    tool_result?: string
    text?: string
    error?: string
    [key: string]: unknown
  }
  // Span information
  spans?: Array<{
    name?: string
    [key: string]: unknown
  }>
}

/**
 * Alternative: Plain text patterns from Picocode console output
 * We also parse these since --quiet mode might not emit tracing logs
 */

// Pattern for tool invocation header (e.g., "── read_file ──────────────────────")
const TOOL_HEADER_REGEX = /^──\s+(\w+)\s+─+$/

// Pattern for thinking indicator
const THINKING_REGEX = /^(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)?\s*Thinking\.{0,3}$/

// Pattern for error messages
const ERROR_REGEX = /^Error:\s*(.+)$/i

/**
 * Parse a line of Picocode CLI output into event(s).
 *
 * Handles both JSON tracing output and plain text console output.
 */
export function parsePicocodeLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) return null

  // First, try to parse as JSON (tracing-subscriber output)
  const json = safeJsonParse<TracingLogLine>(trimmedLine)
  if (json && (json.target === "picocode" || json.fields || json.level)) {
    return parseTracingJson(json, toolMappings, context)
  }

  // Fall back to plain text parsing
  return parsePlainText(trimmedLine, toolMappings, context)
}

/**
 * Parse JSON tracing log lines from tracing-subscriber
 */
function parseTracingJson(
  json: TracingLogLine,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  const fields = json.fields || {}
  const message = fields.message || json.message || ""

  // Session start - emit session event (use a generated ID since picocode doesn't have sessions)
  if (message.includes("starting") || message.includes("initialized")) {
    if (!context.sessionId) {
      const sessionId = `picocode-${Date.now()}`
      context.sessionId = sessionId
      return { type: "session", id: sessionId }
    }
    return null
  }

  // Tool call events
  if (fields.tool_name) {
    const toolName = fields.tool_name as string
    const normalized = normalizeToolName(toolName, toolMappings)
    return createToolStartEvent(normalized, fields.tool_args, toolMappings)
  }

  // Tool result
  if (fields.tool_result !== undefined) {
    return { type: "tool_end", output: String(fields.tool_result) }
  }

  // Text output from assistant
  if (fields.text) {
    return { type: "token", text: fields.text as string }
  }

  // Error handling
  if (json.level === "ERROR" || fields.error) {
    const errorMsg = fields.error || message || "Unknown error"
    return { type: "end", error: String(errorMsg) }
  }

  // Check if message contains text content (assistant response)
  if (message && !message.includes("tool") && !message.includes("Thinking")) {
    // Could be assistant text output
    if (message.length > 10 && !message.startsWith("Starting")) {
      return { type: "token", text: message }
    }
  }

  return null
}

/**
 * Parse plain text console output from Picocode
 */
function parsePlainText(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
  // Skip thinking indicator
  if (THINKING_REGEX.test(line)) {
    return null
  }

  // Check for tool header (e.g., "── read_file ──────────────────────")
  const toolMatch = TOOL_HEADER_REGEX.exec(line)
  if (toolMatch) {
    const toolName = toolMatch[1]
    const normalized = normalizeToolName(toolName, toolMappings)
    return createToolStartEvent(normalized, undefined, toolMappings)
  }

  // Check for error
  const errorMatch = ERROR_REGEX.exec(line)
  if (errorMatch) {
    return { type: "end", error: errorMatch[1] }
  }

  // Check for session start markers
  if (
    line.includes("Welcome to") ||
    line.includes("picocode") ||
    line.includes("Starting session")
  ) {
    if (!context.sessionId) {
      const sessionId = `picocode-${Date.now()}`
      context.sessionId = sessionId
      return { type: "session", id: sessionId }
    }
    return null
  }

  // Check for completion markers
  if (line === "Done" || line === "Completed" || line.includes("Goodbye")) {
    return { type: "end" }
  }

  // Separator lines (used between tool outputs)
  if (/^[─═]{3,}$/.test(line)) {
    // Tool output separator - might indicate tool_end
    const lastState = context.state.lastToolStarted as boolean | undefined
    if (lastState) {
      context.state.lastToolStarted = false
      return { type: "tool_end" }
    }
    return null
  }

  // For any other non-empty line, treat as token/text output
  // This captures the assistant's actual responses
  if (line.length > 0 && !line.startsWith("─") && !line.startsWith(">")) {
    // Mark that we may have started outputting
    context.state.hasOutput = true
    return { type: "token", text: line + "\n" }
  }

  return null
}
