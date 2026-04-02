/**
 * Gemini CLI output parser
 *
 * Pure function for parsing Gemini CLI JSON output.
 * Note: Gemini requires stateful parsing for tool output buffering.
 */

import type { Event } from "../../types/events.js"
import type { ParseContext } from "../../core/agent.js"
import { createToolStartEvent, normalizeToolName } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"

/**
 * Raw event types from Gemini's JSON stream
 */
interface GeminiInit {
  type: "init"
  session_id: string
}

interface GeminiAssistantDelta {
  type: "assistant.delta"
  text: string
}

interface GeminiMessage {
  type: "message"
  role: string
  content: string
  delta?: boolean
}

interface GeminiResult {
  type: "result"
  status: string
}

interface GeminiToolStart {
  type: "tool.start"
  name: string
  input?: unknown
}

interface GeminiToolDelta {
  type: "tool.delta"
  text: string
}

interface GeminiToolEnd {
  type: "tool.end"
}

interface GeminiAssistantComplete {
  type: "assistant.complete"
}

type GeminiEvent =
  | GeminiInit
  | GeminiAssistantDelta
  | GeminiMessage
  | GeminiResult
  | GeminiToolStart
  | GeminiToolDelta
  | GeminiToolEnd
  | GeminiAssistantComplete

/**
 * Parse a line of Gemini CLI output into event(s).
 *
 * Uses context.state.toolOutputBuffer for stateful tool output accumulation.
 */
export function parseGeminiLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | null {
  const json = safeJsonParse<GeminiEvent>(line)
  if (!json) {
    return null
  }

  // Session init
  if (json.type === "init") {
    return { type: "session", id: json.session_id }
  }

  // Assistant text delta (legacy format)
  if (json.type === "assistant.delta") {
    return { type: "token", text: json.text }
  }

  // Message event (new format)
  if (json.type === "message") {
    if (json.role === "assistant" && json.content) {
      return { type: "token", text: json.content }
    }
    // Skip user messages
    return null
  }

  // Result event (new format) - marks completion
  if (json.type === "result") {
    return { type: "end" }
  }

  // Tool start
  if (json.type === "tool.start") {
    context.state.toolOutputBuffer = ""
    const name = normalizeToolName(json.name.toLowerCase(), toolMappings)
    return createToolStartEvent(name, json.input, toolMappings)
  }

  // Tool delta (streaming tool input or output)
  if (json.type === "tool.delta") {
    const buffer = (context.state.toolOutputBuffer as string) ?? ""
    context.state.toolOutputBuffer = buffer + json.text
    return { type: "tool_delta", text: json.text }
  }

  // Tool end
  if (json.type === "tool.end") {
    const output =
      ((context.state.toolOutputBuffer as string) ?? "").trim() || undefined
    context.state.toolOutputBuffer = ""
    return { type: "tool_end", output }
  }

  // Assistant complete (legacy format)
  if (json.type === "assistant.complete") {
    return { type: "end" }
  }

  return null
}
