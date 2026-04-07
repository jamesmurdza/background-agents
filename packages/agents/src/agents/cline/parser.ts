/**
 * Cline CLI output parser
 *
 * Pure function for parsing Cline CLI JSON output.
 * Cline outputs JSON lines when run with --json flag.
 *
 * Actual Cline CLI v2.x event types:
 * - task_started: Session initialization with taskId
 * - say: Various message types (task, text, api_req_started, tool, etc.)
 * - task_completed: Task completion
 * - error: Error events
 */

import type { Event } from "../../types/events.js"
import type { ShellToolInput } from "../../types/events.js"
import { createToolStartEvent } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"
import { normalizeClineToolName } from "./tools.js"
import type { ParseContext } from "../../core/agent.js"

/**
 * Cline CLI v2.x event types (actual output format)
 */
interface ClineTaskStarted {
  type: "task_started"
  taskId: string
}

interface ClineSay {
  type: "say"
  say: string // "task", "text", "api_req_started", "api_req_finished", "tool", "command", etc.
  ts?: number
  text?: string
  modelInfo?: {
    providerId: string
    modelId: string
    mode: string
  }
  conversationHistoryIndex?: number
}

interface ClineTaskCompleted {
  type: "task_completed"
  taskId?: string
  ts?: number
}

interface ClineError {
  type: "error"
  message?: string
  error?: string | { message?: string }
}

// Legacy/alternative event types (for compatibility)
interface ClineInitEvent {
  type: "init" | "session"
  session_id?: string
  sessionId?: string
  id?: string
}

interface ClineMessageDelta {
  type: "message" | "text" | "assistant" | "content_block_delta"
  text?: string
  content?: string
  delta?: {
    type?: string
    text?: string
  }
  role?: string
}

interface ClineToolUse {
  type: "tool_use" | "tool_call" | "tool_start"
  name?: string
  tool?: string
  tool_name?: string
  id?: string
  input?: Record<string, unknown>
  arguments?: Record<string, unknown>
  parameters?: Record<string, unknown>
}

interface ClineToolResult {
  type: "tool_result" | "tool_end" | "tool_response"
  tool_use_id?: string
  id?: string
  output?: string
  result?: string | { content?: string; text?: string }
  content?: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}

interface ClineComplete {
  type: "result" | "complete" | "end" | "done" | "turn_complete"
  status?: string
  subtype?: string
}

type ClineEvent =
  | ClineTaskStarted
  | ClineSay
  | ClineTaskCompleted
  | ClineError
  | ClineInitEvent
  | ClineMessageDelta
  | ClineToolUse
  | ClineToolResult
  | ClineComplete

/**
 * Parse a line of Cline CLI output into event(s).
 */
export function parseClineLine(
  line: string,
  toolMappings: Record<string, string>,
  _context?: ParseContext
): Event | Event[] | null {
  // Strip SSE data prefix if present
  const trimmed = line.startsWith("data: ") ? line.slice(6) : line

  const json = safeJsonParse<ClineEvent>(trimmed)
  if (!json) {
    return null
  }

  // Cline v2.x: task_started event (session initialization)
  if (json.type === "task_started") {
    const event = json as ClineTaskStarted
    return { type: "session", id: event.taskId }
  }

  // Cline v2.x: say event (various message types)
  if (json.type === "say") {
    const event = json as ClineSay

    // Handle different "say" types
    switch (event.say) {
      case "text":
      case "task":
        // Text output from assistant
        if (event.text) {
          return { type: "token", text: event.text }
        }
        break

      case "tool":
      case "command":
        // Tool invocation - extract tool name and input from text if available
        if (event.text) {
          // Try to parse as JSON for structured tool call
          const toolData = safeJsonParse<{
            tool?: string
            command?: string
            input?: Record<string, unknown>
          }>(event.text)
          if (toolData) {
            const toolName = toolData.tool || toolData.command || "shell"
            const normalizedName = normalizeClineToolName(toolName)
            return createToolStartEvent(normalizedName, toolData.input || {}, toolMappings)
          }
          // Otherwise treat as shell command
          return createToolStartEvent("shell", { command: event.text }, toolMappings)
        }
        break

      case "api_req_started":
      case "api_req_finished":
        // API request events - ignore for now
        break

      case "completion_result":
        // Completion result - could extract final answer
        if (event.text) {
          return { type: "token", text: event.text }
        }
        break

      default:
        // Unknown say type - if it has text, emit as token
        if (event.text && event.say !== "user_feedback" && event.say !== "user_feedback_diff") {
          return { type: "token", text: event.text }
        }
        break
    }
    return null
  }

  // Cline v2.x: task_completed event
  if (json.type === "task_completed") {
    return { type: "end" }
  }

  // Legacy: Session/init events
  if (json.type === "init" || json.type === "session") {
    const sessionId =
      (json as ClineInitEvent).session_id ||
      (json as ClineInitEvent).sessionId ||
      (json as ClineInitEvent).id
    if (sessionId) {
      return { type: "session", id: sessionId }
    }
    return null
  }

  // Legacy: Message/text delta events
  if (
    json.type === "message" ||
    json.type === "text" ||
    json.type === "assistant" ||
    json.type === "content_block_delta"
  ) {
    const msg = json as ClineMessageDelta

    // Skip user messages
    if (msg.role === "user") {
      return null
    }

    // Extract text from various possible locations
    let text: string | undefined
    if (msg.text) {
      text = msg.text
    } else if (msg.content && typeof msg.content === "string") {
      text = msg.content
    } else if (msg.delta?.text) {
      text = msg.delta.text
    }

    if (text) {
      return { type: "token", text }
    }
    return null
  }

  // Legacy: Tool use/start events
  if (
    json.type === "tool_use" ||
    json.type === "tool_call" ||
    json.type === "tool_start"
  ) {
    const toolEvent = json as ClineToolUse
    const name =
      toolEvent.name || toolEvent.tool || toolEvent.tool_name || "unknown"
    const normalizedName = normalizeClineToolName(name)

    // Extract input from various possible locations
    let input: unknown =
      toolEvent.input || toolEvent.arguments || toolEvent.parameters || {}

    // Handle shell/command tool specially
    if (normalizedName === "shell" && typeof input === "object" && input !== null) {
      const inputObj = input as Record<string, unknown>
      if (typeof inputObj.command === "string") {
        input = { command: inputObj.command } satisfies ShellToolInput
      }
    }

    return createToolStartEvent(normalizedName, input, toolMappings)
  }

  // Legacy: Tool result/end events
  if (
    json.type === "tool_result" ||
    json.type === "tool_end" ||
    json.type === "tool_response"
  ) {
    const resultEvent = json as ClineToolResult

    // Extract output from various possible locations
    let output: string | undefined

    if (resultEvent.output) {
      output = resultEvent.output
    } else if (resultEvent.result) {
      if (typeof resultEvent.result === "string") {
        output = resultEvent.result
      } else if (resultEvent.result.content) {
        output = resultEvent.result.content
      } else if (resultEvent.result.text) {
        output = resultEvent.result.text
      }
    } else if (resultEvent.content) {
      if (typeof resultEvent.content === "string") {
        output = resultEvent.content
      } else if (Array.isArray(resultEvent.content)) {
        const textBlock = resultEvent.content.find((b) => b.type === "text")
        if (textBlock?.text) {
          output = textBlock.text
        }
      }
    }

    // Handle error results
    if (resultEvent.is_error && output) {
      output = `Error: ${output}`
    }

    return { type: "tool_end", output }
  }

  // Legacy: Completion events
  if (
    json.type === "result" ||
    json.type === "complete" ||
    json.type === "end" ||
    json.type === "done" ||
    json.type === "turn_complete"
  ) {
    return { type: "end" }
  }

  // Error events
  if (json.type === "error") {
    const errorEvent = json as ClineError
    let errorMessage: string | undefined

    if (errorEvent.message) {
      errorMessage = errorEvent.message
    } else if (typeof errorEvent.error === "string") {
      errorMessage = errorEvent.error
    } else if (
      typeof errorEvent.error === "object" &&
      errorEvent.error?.message
    ) {
      errorMessage = errorEvent.error.message
    }

    return { type: "end", error: errorMessage }
  }

  return null
}
