/**
 * Pi Coding Agent CLI output parser
 *
 * Pure function for parsing Pi CLI JSON output (--mode json).
 * No state, no side effects - easily testable.
 *
 * Pi JSON output events are documented at:
 * https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#cli-reference
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, stringifyToolResult } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Raw event types from Pi CLI's --mode json output
 */

// Session header - first line of output
interface PiSessionHeader {
  type: "session"
  version?: number
  id: string
  timestamp?: string
  cwd?: string
}

// Agent lifecycle events
interface PiAgentStart {
  type: "agent_start"
}

interface PiAgentEnd {
  type: "agent_end"
  messages?: unknown[]
}

// Turn lifecycle events
interface PiTurnStart {
  type: "turn_start"
}

interface PiTurnEnd {
  type: "turn_end"
  message?: unknown
  toolResults?: unknown[]
}

// Message lifecycle events
interface PiMessageStart {
  type: "message_start"
  message?: {
    role?: string
    content?: unknown[]
  }
}

interface PiMessageUpdate {
  type: "message_update"
  message?: unknown
  assistantMessageEvent?: {
    type: string
    delta?: string
    text?: string
  }
}

interface PiMessageEnd {
  type: "message_end"
  message?: unknown
}

// Tool execution events
interface PiToolExecutionStart {
  type: "tool_execution_start"
  toolCallId?: string
  toolName?: string
  args?: unknown
}

interface PiToolExecutionUpdate {
  type: "tool_execution_update"
  toolCallId?: string
  toolName?: string
  args?: unknown
  partialResult?: unknown
}

interface PiToolExecutionEnd {
  type: "tool_execution_end"
  toolCallId?: string
  toolName?: string
  result?: unknown
  isError?: boolean
}

// Error event
interface PiErrorEvent {
  type: "error"
  error?: string
  message?: string
}

// Compaction events (optional, we can ignore these)
interface PiCompactionStart {
  type: "compaction_start"
  reason?: string
}

interface PiCompactionEnd {
  type: "compaction_end"
  reason?: string
  result?: unknown
  aborted?: boolean
  willRetry?: boolean
  errorMessage?: string
}

// Auto retry events
interface PiAutoRetryStart {
  type: "auto_retry_start"
  attempt?: number
  maxAttempts?: number
  delayMs?: number
  errorMessage?: string
}

interface PiAutoRetryEnd {
  type: "auto_retry_end"
  success?: boolean
  attempt?: number
  finalError?: string
}

// Queue update event
interface PiQueueUpdate {
  type: "queue_update"
  steering?: string[]
  followUp?: string[]
}

type PiEvent =
  | PiSessionHeader
  | PiAgentStart
  | PiAgentEnd
  | PiTurnStart
  | PiTurnEnd
  | PiMessageStart
  | PiMessageUpdate
  | PiMessageEnd
  | PiToolExecutionStart
  | PiToolExecutionUpdate
  | PiToolExecutionEnd
  | PiErrorEvent
  | PiCompactionStart
  | PiCompactionEnd
  | PiAutoRetryStart
  | PiAutoRetryEnd
  | PiQueueUpdate

/**
 * Parse a line of Pi CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @param context - Parse context for stateful parsing
 * @returns Event, array of events, or null if line should be ignored
 */
export function parsePiLine(
  line: string,
  toolMappings: Record<string, string>,
  _context: ParseContext
): Event | Event[] | null {
  const json = safeJsonParse<PiEvent>(line)
  if (!json) {
    return null
  }

  // Session header - first line contains session info
  if (json.type === "session" && "id" in json) {
    return { type: "session", id: json.id }
  }

  // Message update with text delta - this is the main token stream
  if (json.type === "message_update" && "assistantMessageEvent" in json) {
    const event = json.assistantMessageEvent
    if (event) {
      // text_delta events contain the actual response text
      if (event.type === "text_delta" && event.delta) {
        return { type: "token", text: event.delta }
      }
      // Some versions may use 'text' instead of 'delta'
      if (event.type === "text_delta" && event.text) {
        return { type: "token", text: event.text }
      }
    }
    return null
  }

  // Tool execution start
  if (json.type === "tool_execution_start") {
    const toolName = json.toolName ?? "unknown"
    return createToolStartEvent(toolName, json.args, toolMappings)
  }

  // Tool execution update - partial results (emit as tool_delta)
  if (json.type === "tool_execution_update") {
    const text = stringifyToolResult(json.partialResult)
    if (text !== undefined) {
      return { type: "tool_delta", text }
    }
    return null
  }

  // Tool execution end
  if (json.type === "tool_execution_end") {
    return { type: "tool_end", output: stringifyToolResult(json.result) }
  }

  // Agent end - signals completion
  if (json.type === "agent_end") {
    return { type: "end" }
  }

  // Error events
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json.message ?? json, "pi") }
  }

  // Auto retry end with failure
  if (json.type === "auto_retry_end" && !json.success) {
    return { type: "end", error: resolveAgentError(json.finalError ?? "Auto retry failed", "pi") }
  }

  // These events are informational, we can ignore them:
  // - agent_start, turn_start, turn_end
  // - message_start, message_end
  // - compaction_start, compaction_end
  // - auto_retry_start
  // - queue_update

  return null
}
