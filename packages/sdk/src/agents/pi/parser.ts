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

/**
 * Pi reports provider/model failures (auth, insufficient balance, quota,
 * unavailable model, …) not as a standalone `{type:"error"}` event but as an
 * assistant message whose `stopReason` is "error" with the raw provider text on
 * `errorMessage`. These ride on message_end / turn_end / agent_end. Pull that
 * string out so the terminal `end` can carry a classified error instead of
 * looking like a silent success.
 */
function piMessageError(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined
  const m = message as { stopReason?: unknown; errorMessage?: unknown }
  if (m.stopReason === "error" && typeof m.errorMessage === "string" && m.errorMessage.trim()) {
    return m.errorMessage.trim()
  }
  return undefined
}

/** Last errored assistant message in an agent_end `messages` array, if any. */
function piEndError(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const err = piMessageError(messages[i])
    if (err) return err
  }
  return undefined
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
  context: ParseContext
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

  // message_end / turn_end carry the assistant message. On a provider failure Pi
  // sets stopReason "error" + errorMessage here (ahead of the terminal
  // agent_end). Stash the latest so agent_end can surface it even if its own
  // messages array doesn't; a successful stop clears any stale stash.
  if (json.type === "message_end" || json.type === "turn_end") {
    const message = (json as { message?: unknown }).message
    const err = piMessageError(message)
    if (err) {
      context.state.piError = err
    } else if (
      message &&
      typeof message === "object" &&
      (message as { stopReason?: unknown }).stopReason === "stop"
    ) {
      context.state.piError = undefined
    }
    return null
  }

  // Agent end - terminal completion for the turn. Surface a provider error when
  // the final assistant message failed (auth, balance, quota, …); otherwise a
  // clean end. Deduped via `piEnded` so Pi's per-retry agent_end events (each
  // attempt emits one) don't produce multiple end events.
  if (json.type === "agent_end") {
    if (context.state.piEnded) return null
    context.state.piEnded = true
    const err = piEndError(json.messages) ?? (context.state.piError as string | undefined)
    return err ? { type: "end", error: resolveAgentError(err, "pi") } : { type: "end" }
  }

  // Error events
  if (json.type === "error") {
    if (context.state.piEnded) return null
    context.state.piEnded = true
    return { type: "end", error: resolveAgentError(json.error ?? json.message ?? json, "pi") }
  }

  // Auto retry end with failure
  if (json.type === "auto_retry_end" && !json.success) {
    if (context.state.piEnded) return null
    context.state.piEnded = true
    return { type: "end", error: resolveAgentError(json.finalError ?? "Auto retry failed", "pi") }
  }

  // These events are informational, we can ignore them:
  // - agent_start, turn_start
  // - message_start
  // - compaction_start, compaction_end
  // - auto_retry_start
  // - queue_update

  return null
}
