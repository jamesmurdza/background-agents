/**
 * ELIZA CLI output parser
 *
 * Pure function for parsing ELIZA CLI JSON output.
 * ELIZA outputs Claude-compatible JSON, so this parser is similar to Claude's.
 */

import type { Event } from "../../types/events"
import { createToolStartEvent } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"

/**
 * Raw event types from ELIZA CLI's output
 */
interface ElizaSystemInit {
  type: "system"
  subtype: "init"
  session_id: string
}

interface ElizaAssistantMessage {
  type: "assistant"
  message: {
    id: string
    content: Array<{
      type: "text" | "tool_use"
      text?: string
      name?: string
      id?: string
      input?: unknown
    }>
  }
  session_id: string
}

interface ElizaResult {
  type: "result"
  subtype?: "success" | "error"
  is_error?: boolean
  result?: string
  session_id: string
}

interface ElizaUserMessage {
  type: "user"
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: string
      is_error?: boolean
    }>
  }
  session_id?: string
}

type ElizaEvent =
  | ElizaSystemInit
  | ElizaAssistantMessage
  | ElizaUserMessage
  | ElizaResult

/**
 * Parse a line of ELIZA CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @returns Event, array of events, or null if line should be ignored
 */
export function parseElizaLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<ElizaEvent>(line)
  if (!json) {
    return null
  }

  // System init event contains session ID
  if (json.type === "system" && "subtype" in json && json.subtype === "init") {
    return { type: "session", id: json.session_id }
  }

  // Assistant message contains the response content
  if (json.type === "assistant" && "message" in json) {
    const content = json.message.content
    if (content && content.length > 0) {
      const events: Event[] = []

      for (const block of content) {
        if (block.type === "text" && block.text) {
          events.push({ type: "token", text: block.text })
        }
        if (block.type === "tool_use" && block.name) {
          events.push(createToolStartEvent(block.name, block.input, toolMappings))
        }
      }

      // Return single event or array
      if (events.length === 1) {
        return events[0]
      } else if (events.length > 1) {
        return events
      }
    }
    return null
  }

  // Tool result inside user message
  if (json.type === "user" && json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === "tool_result") {
        const output = block.is_error
          ? `Error: ${block.content}`
          : block.content
        return { type: "tool_end", output }
      }
    }
    return null
  }

  // Result event marks end of interaction
  if (json.type === "result") {
    const err = json.is_error || json.subtype === "error" ? json.result : undefined
    return { type: "end", ...(err ? { error: err } : {}) }
  }

  return null
}
