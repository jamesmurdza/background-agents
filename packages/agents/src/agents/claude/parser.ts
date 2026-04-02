/**
 * Claude CLI output parser
 *
 * Pure function for parsing Claude CLI JSON output.
 * No state, no side effects - easily testable.
 */

import type { Event } from "../../types/events.js"
import { createToolStartEvent } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"

/**
 * Raw event types from Claude CLI's stream-json output
 */
interface ClaudeSystemInit {
  type: "system"
  subtype: "init"
  session_id: string
}

interface ClaudeAssistantMessage {
  type: "assistant"
  message: {
    id: string
    content: Array<{
      type: "text" | "tool_use"
      text?: string
      name?: string
      input?: unknown
    }>
  }
  session_id: string
}

interface ClaudeResult {
  type: "result"
  subtype?: "success" | "error" | "error_during_execution" | "error_max_turns"
  result?: string
  error?: string
  session_id: string
}

interface ClaudeToolUse {
  type: "tool_use"
  name: string
  input?: unknown
}

interface ClaudeToolResult {
  type: "tool_result"
  tool_use_id: string
  result?: string
  content?: string | Array<{ type: string; text?: string }>
}

interface ClaudeUserMessage {
  type: "user"
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: string | Array<{ type: string; text?: string }>
    }>
  }
}

type ClaudeEvent =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResult
  | ClaudeToolUse
  | ClaudeToolResult

/**
 * Extract output from a tool result object
 */
function toolResultOutput(obj: ClaudeToolResult): string | undefined {
  let out = obj.result
  if (out === undefined && obj.content !== undefined) {
    if (typeof obj.content === "string") out = obj.content
    else if (Array.isArray(obj.content) && obj.content[0]?.text)
      out = obj.content[0].text
  }
  return out
}

/**
 * Parse a line of Claude CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @returns Event, array of events, or null if line should be ignored
 */
export function parseClaudeLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<ClaudeEvent>(line)
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
      // Find text content and emit as token
      for (const block of content) {
        if (block.type === "text" && block.text) {
          return { type: "token", text: block.text }
        }
        if (block.type === "tool_use" && block.name) {
          return createToolStartEvent(block.name, block.input, toolMappings)
        }
      }
    }
    return null
  }

  // Tool use event
  if (json.type === "tool_use" && "name" in json) {
    return createToolStartEvent(json.name, json.input, toolMappings)
  }

  // Tool result (standalone)
  if (json.type === "tool_result") {
    return { type: "tool_end", output: toolResultOutput(json) }
  }

  // Tool result inside user message
  if (json.type === "user" && json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === "tool_result") {
        let out: string | undefined
        if (typeof block.content === "string") out = block.content
        else if (Array.isArray(block.content) && block.content[0]?.text)
          out = block.content[0].text
        return { type: "tool_end", output: out }
      }
    }
  }

  // Result event marks end of interaction (success or CLI error)
  if (json.type === "result") {
    const err =
      (json as ClaudeResult).subtype === "error_during_execution" ||
      (json as ClaudeResult).subtype === "error"
        ? ((json as ClaudeResult).error ??
          (json as ClaudeResult).result ??
          "Unknown error")
        : undefined
    return { type: "end", ...(err ? { error: err } : {}) }
  }

  return null
}
