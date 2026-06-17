/**
 * Gemini CLI output parser
 *
 * Pure function for parsing Gemini CLI JSON output.
 * Note: Gemini requires stateful parsing for tool output buffering.
 *
 * Reference schema (from actual CLI output):
 *   { type: "init", session_id }
 *   { type: "message", role, content, delta? }
 *   { type: "tool_use", tool_name, tool_id, parameters }   ← tool starts
 *   { type: "tool_result", tool_id, status, output? }      ← tool ends
 *   { type: "result", status, stats }                      ← turn end
 *
 * Legacy schema (older CLI versions — kept for compatibility):
 *   { type: "assistant.delta", text }
 *   { type: "tool.start", name, input? }
 *   { type: "tool.delta", text }
 *   { type: "tool.end" }
 *   { type: "assistant.complete" }
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent, normalizeToolName } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"

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

/** Current Gemini CLI: tool invocation */
interface GeminiToolUse {
  type: "tool_use"
  tool_name: string
  tool_id: string
  parameters?: unknown
}

/** Current Gemini CLI: tool result (output of invocation) */
interface GeminiToolResult {
  type: "tool_result"
  tool_id: string
  status: string
  output?: string
}

/** Legacy Gemini CLI */
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
  | GeminiToolUse
  | GeminiToolResult
  | GeminiToolStart
  | GeminiToolDelta
  | GeminiToolEnd
  | GeminiAssistantComplete

/**
 * Parse a line of Gemini CLI output into event(s).
 *
 * Uses context.state for stateful tracking:
 *   - pendingToolIds: Map<tool_id, true> — tracks tool_use events awaiting their tool_result
 *   - toolOutputBuffer: string — legacy streaming buffer
 */
export function parseGeminiLine(
  line: string,
  toolMappings: Record<string, string>,
  context: ParseContext
): Event | Event[] | null {
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

  // Message event (current Gemini format) — text only, tool calls are separate
  if (json.type === "message") {
    if (json.role === "assistant" && json.content) {
      return { type: "token", text: json.content }
    }
    // Skip user messages
    return null
  }

  // Result event — marks turn completion
  if (json.type === "result") {
    return { type: "end" }
  }

  // ── Current Gemini format: tool_use + tool_result ──────────────────────────

  // tool_use: the agent is invoking a tool.
  // We emit tool_start immediately, and stash the tool_id so we can pair the output.
  if (json.type === "tool_use") {
    const name = normalizeToolName(json.tool_name.toLowerCase(), toolMappings)
    // Track pending tool_id → tool event pairing in parse context
    if (!context.state.pendingToolIds) {
      context.state.pendingToolIds = {}
    }
    // Store the normalized name so tool_result can reference it (not strictly needed but aids debugging)
    ;(context.state.pendingToolIds as Record<string, string>)[json.tool_id] = name
    return createToolStartEvent(name, json.parameters, toolMappings)
  }

  // tool_result: the tool invocation completed, contains stdout/stderr in output.
  // We pair it with the most recently started tool_use via tool_id.
  if (json.type === "tool_result") {
    // Clean up the tracked tool_id
    if (context.state.pendingToolIds) {
      delete (context.state.pendingToolIds as Record<string, string>)[json.tool_id]
    }
    const output = typeof json.output === "string" && json.output.trim()
      ? json.output.trim()
      : undefined
    return { type: "tool_end", output }
  }

  // ── Legacy Gemini streaming format ────────────────────────────────────────

  // Tool start (legacy)
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
