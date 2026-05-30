/**
 * GitHub Copilot CLI output parser
 *
 * Parses JSONL events from `copilot -p "..." --output-format=json --silent --autopilot`.
 *
 * Real event types observed from @github/copilot CLI:
 *   - assistant.message_delta            → TokenEvent  (deltaContent field)
 *   - tool.execution_start               → ToolStartEvent
 *   - tool.execution_complete            → ToolEndEvent
 *   - session.task_complete              → EndEvent  (final event before process exits)
 *   - assistant.turn_end                 → ignored (autopilot fires a continuation turn after this)
 *   - result                             → EndEvent fallback (exitCode field)
 *
 * Legacy naming conventions also supported for forward-compat:
 *   - message.delta / assistant.message_delta  → TokenEvent
 *   - tool.call / tool.start                   → ToolStartEvent
 *   - tool.result / tool.end                   → ToolEndEvent
 *   - turn.end                                 → EndEvent
 *   - session.start                            → SessionEvent
 *   - session.shutdown                         → EndEvent
 */

import type { ParseContext } from "../../core/agent"
import type { Event } from "../../types/events"
import { createToolStartEvent } from "../../core/tools"
import { getParserState } from "../../core/parse-state"
import { safeJsonParse } from "../../utils/json"

/**
 * Raw event shapes from the Copilot CLI JSONL stream.
 * The `type` field is the discriminator.
 */
interface CopilotBaseEvent {
  type: string
  /** When true, event is internal (reasoning/narration) and should not be shown */
  ephemeral?: boolean
  [key: string]: unknown
}

interface CopilotSessionStart extends CopilotBaseEvent {
  type: "session.start"
  sessionId?: string
}

interface CopilotMessageDelta extends CopilotBaseEvent {
  type: "message.delta" | "assistant.message_delta"
  // @github/copilot uses data.deltaContent; legacy uses content at top level
  data?: { deltaContent?: string; messageId?: string }
  content?: string
  deltaContent?: string
  role?: string
}

interface CopilotToolExecutionStart extends CopilotBaseEvent {
  type: "tool.execution_start" | "tool.call" | "tool.start"
  data?: { toolName?: string; arguments?: Record<string, unknown>; toolCallId?: string }
  name?: string
  arguments?: Record<string, unknown>
  callId?: string
}

interface CopilotToolExecutionComplete extends CopilotBaseEvent {
  type: "tool.execution_complete" | "tool.result" | "tool.end"
  data?: { result?: { content?: string }; success?: boolean; toolCallId?: string }
  callId?: string
  result?: string
  output?: string
  is_error?: boolean
}

interface CopilotTurnEnd extends CopilotBaseEvent {
  type: "turn.end" | "assistant.turn_end"
  status?: string
  error?: string | { message: string }
}

interface CopilotTaskComplete extends CopilotBaseEvent {
  type: "session.task_complete"
  sessionId?: string
  data?: { success?: boolean; summary?: string }
}

interface CopilotResult extends CopilotBaseEvent {
  type: "result"
  exitCode?: number
  sessionId?: string
}

interface CopilotMcpStatus extends CopilotBaseEvent {
  type: "session.mcp_server_status_changed"
  data?: { serverName?: string; status?: string }
}

interface CopilotSessionInfo extends CopilotBaseEvent {
  type: "session.info"
  data?: { infoType?: string; message?: string }
}

interface CopilotSessionShutdown extends CopilotBaseEvent {
  type: "session.shutdown"
}

/**
 * Full message event emitted at the end of each assistant turn.
 * Contains the complete text plus any tool requests.
 * Only the content from messages WITHOUT toolRequests is user-facing.
 */
interface CopilotMessage extends CopilotBaseEvent {
  type: "assistant.message"
  data?: {
    messageId?: string
    content?: string
    toolRequests?: unknown[]
  }
}

type CopilotEvent =
  | CopilotSessionStart
  | CopilotMessageDelta
  | CopilotMessage
  | CopilotToolExecutionStart
  | CopilotToolExecutionComplete
  | CopilotTurnEnd
  | CopilotTaskComplete
  | CopilotResult
  | CopilotMcpStatus
  | CopilotSessionInfo
  | CopilotSessionShutdown
  | CopilotBaseEvent

/**
 * Internal Copilot autopilot workflow-control tools.
 *
 * The Copilot CLI's autopilot mode uses these tools to manage its own
 * execution loop (intent reporting, task completion signalling, etc.).
 * They are not user-visible actions and should not be surfaced in the UI —
 * doing so produces confusing output like "report_intent", "ask_user",
 * "task_complete" appearing as messages.
 */
const COPILOT_INTERNAL_TOOLS = new Set([
  "report_intent",
  "ask_user",
  "task_complete",
  "request_clarification",
  "set_status",
  "get_context",
  "plan",
  "think",
])

/**
 * Stateful tracking the Copilot parser threads through a turn.
 *
 * Stored on `ParseContext.state.copilot` via {@link copilotState}; this
 * replaces the four loose string keys that previously required casts.
 */
class CopilotParseState {
  /**
   * Tool-call IDs for suppressed internal autopilot tools. Recorded on the
   * tool.execution_start so the paired tool.execution_complete is suppressed
   * too (prevents orphan tool_end events).
   */
  suppressedToolIds = new Set<string>()

  /**
   * messageIds whose delta tokens have already been streamed. When
   * assistant.message fires for the same id, its full content would duplicate
   * what the deltas emitted, so it is suppressed.
   */
  streamedMessageIds = new Set<string>()

  /**
   * True once `session.info { infoType: "autopilot_continuation" }` fires.
   * From that point until session.task_complete, events are internal autopilot
   * workflow (narration, bookkeeping) and are suppressed.
   */
  inAutopilotContinuation = false

  /**
   * True once session.task_complete fires. The subsequent `result` event also
   * maps to end — this flag suppresses the duplicate.
   */
  taskComplete = false
}

function copilotState(context: ParseContext): CopilotParseState {
  return getParserState(context, "copilot", () => new CopilotParseState())
}

/**
 * Parse a single JSONL line from the Copilot CLI.
 */
export function parseCopilotLine(
  line: string,
  toolMappings: Record<string, string>,
  context?: ParseContext
): Event | null {
  const json = safeJsonParse<CopilotEvent>(line)
  if (!json || !json.type) return null

  // ─── Session start ────────────────────────────────────────
  if (json.type === "session.start") {
    const ev = json as CopilotSessionStart
    return { type: "session", id: ev.sessionId ?? "" }
  }

  // ─── Text streaming ───────────────────────────────────────
  // @github/copilot wraps content in data.deltaContent.
  //
  // The `ephemeral` flag is NOT a reliable discriminator here: free-tier models
  // (gpt-5-mini) mark ALL deltas as ephemeral: true — including the real
  // user-facing response. The correct signal is whether we are inside an
  // autopilot continuation turn (set by the session.info handler below).
  // Continuation turns are internal workflow turns (narration, task_complete
  // bookkeeping) and must be suppressed entirely.
  //
  // Note: the legacy `message.delta` path (non-@github/copilot format) is
  // also guarded here. It does not appear in modern captures but is kept for
  // forward-compat; it has no ephemeral flag so the continuation guard is
  // the only filter applied.
  if (json.type === "message.delta" || json.type === "assistant.message_delta") {
    if (context && copilotState(context).inAutopilotContinuation) return null
    const ev = json as CopilotMessageDelta
    const text = ev.data?.deltaContent ?? ev.content ?? ev.deltaContent ?? ""
    if (!text) return null
    // Record the messageId so the paired assistant.message is suppressed.
    const messageId = ev.data?.messageId
    if (messageId && context) {
      copilotState(context).streamedMessageIds.add(messageId)
    }
    return { type: "token", text }
  }

  // ─── Full message (end of turn) ────────────────────────────
  // Paid-tier models (gpt-4.1) emit a single assistant.message with the
  // complete response text and an empty toolRequests array. Free-tier models
  // (gpt-5-mini) skip this event entirely and rely solely on deltas.
  //
  // Suppress if:
  //   - We are in an autopilot continuation turn (internal narration/bookkeeping)
  //   - The message has tool requests (it's a prelude to a tool call, not a response)
  if (json.type === "assistant.message") {
    if (context && copilotState(context).inAutopilotContinuation) return null
    const ev = json as CopilotMessage
    const toolRequests = ev.data?.toolRequests
    const hasToolCalls = Array.isArray(toolRequests) && toolRequests.length > 0
    if (hasToolCalls) return null
    // Suppress if deltas were already streamed for this messageId —
    // the full text would duplicate what the streaming path already emitted.
    const messageId = ev.data?.messageId
    if (
      messageId &&
      context &&
      copilotState(context).streamedMessageIds.has(messageId)
    ) {
      return null
    }
    const text = ev.data?.content ?? ""
    if (!text) return null
    return { type: "token", text }
  }

  // ─── Tool invocation start ────────────────────────────────
  // @github/copilot uses tool.execution_start with data.toolName
  if (
    json.type === "tool.execution_start" ||
    json.type === "tool.call" ||
    json.type === "tool.start"
  ) {
    const ev = json as CopilotToolExecutionStart
    const name = ev.data?.toolName ?? ev.name ?? "unknown"

    // Suppress internal autopilot workflow-control tools — they manage the
    // CLI's own execution loop and are not user-visible actions.
    if (COPILOT_INTERNAL_TOOLS.has(name)) {
      // Record the tool call ID so the paired tool.execution_complete is
      // also suppressed (prevents orphan tool_end events).
      const callId = ev.data?.toolCallId ?? ev.callId
      if (callId && context) copilotState(context).suppressedToolIds.add(callId)
      return null
    }
    const args = ev.data?.arguments ?? ev.arguments
    return createToolStartEvent(name, args, toolMappings)
  }

  // ─── Tool result ──────────────────────────────────────────
  // @github/copilot uses tool.execution_complete with data.result.content
  if (
    json.type === "tool.execution_complete" ||
    json.type === "tool.result" ||
    json.type === "tool.end"
  ) {
    const ev = json as CopilotToolExecutionComplete
    // Suppress tool_end for suppressed internal tool calls.
    const callId = ev.data?.toolCallId ?? ev.callId
    if (callId && context && copilotState(context).suppressedToolIds.has(callId)) {
      copilotState(context).suppressedToolIds.delete(callId) // clean up
      return null
    }
    const output = ev.data?.result?.content ?? ev.result ?? ev.output
    return { type: "tool_end", output }
  }

  // ─── MCP server auth failure ─────────────────────────────
  // Fired when the built-in github-mcp-server can't authenticate.
  // This is an actionable auth error, not a generic crash.
  if (json.type === "session.mcp_server_status_changed") {
    const ev = json as CopilotMcpStatus
    if (ev.data?.status === "failed") {
      const server = ev.data?.serverName ?? "GitHub MCP server"
      return {
        type: "end",
        error:
          `${server} failed to connect. ` +
          `Ensure your COPILOT_GITHUB_TOKEN has the "Copilot Requests" permission ` +
          `and has not expired.`,
      }
    }
    return null
  }

  // ─── Autopilot continuation signal ──────────────────────────
  // Fired between the user-facing turn and the internal continuation turn.
  // Everything after this event (until session.task_complete) is internal
  // autopilot workflow — model narration and task bookkeeping. Set a flag in
  // context.sta te so the delta and message handlers can suppress those events.
  if (json.type === "session.info") {
    const ev = json as CopilotSessionInfo
    if (ev.data?.infoType === "autopilot_continuation" && context) {
      copilotState(context).inAutopilotContinuation = true
    }
    return null
  }

  // ─── Task complete (final event before process exits in autopilot) ───
  // This is the true terminal event in autopilot mode. The `result` event
  // that follows also maps to end — track completion to avoid a duplicate.
  if (json.type === "session.task_complete") {
    const ev = json as CopilotTaskComplete
    if (context) {
      copilotState(context).taskComplete = true
      // Capture the session ID so the next turn can resume with --continue.
      if (ev.sessionId) context.sessionId = ev.sessionId
    }
    return { type: "end" }
  }

  // ─── Result line (process-level exit summary) ─────────────
  // In autopilot mode session.task_complete already emitted end; suppress
  // this duplicate. In non-autopilot mode (no task_complete) this is the
  // only terminal event, so emit it normally.
  if (json.type === "result") {
    const ev = json as CopilotResult
    // Always capture the session ID regardless of exit code — it's needed
    // so the next turn can pass --continue to resume the session.
    if (context && ev.sessionId) context.sessionId = ev.sessionId
    if (context && copilotState(context).taskComplete) return null
    const error = ev.exitCode !== 0 ? `Process exited with code ${ev.exitCode}` : undefined
    return { type: "end", error }
  }

  // ─── Turn end ─────────────────────────────────────────────
  // In autopilot mode the CLI fires a continuation turn after assistant.turn_end,
  // so we do NOT emit end here — we wait for session.task_complete instead.
  // For legacy turn.end (non-autopilot) we do emit end.
  if (json.type === "turn.end") {
    const ev = json as CopilotTurnEnd
    let error: string | undefined
    if (ev.status && ev.status !== "success") {
      if (typeof ev.error === "string") {
        error = ev.error
      } else if (ev.error && typeof ev.error === "object" && "message" in ev.error) {
        error = ev.error.message
      } else {
        error = `Turn ended with status: ${ev.status}`
      }
    }
    return { type: "end", error }
  }

  // ─── Session shutdown ─────────────────────────────────────
  if (json.type === "session.shutdown") {
    return { type: "end" }
  }

  // Unknown event type — ignore gracefully
  return null
}
