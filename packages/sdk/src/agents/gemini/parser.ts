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
 *   { type: "result", status, error?, stats }              ← turn end
 *
 * Failure handling (verified against a real out-of-quota run — see
 * tests/fixtures/jsonl-reference/gemini-error.jsonl). When a run fails (out of
 * quota, a paid/Pro model on a free key, bad API key, …) the Gemini CLI:
 *   1. prints the real reason as a *plain-text* JS error dump on stdout, e.g.
 *      `Error when talking to Gemini API … TerminalQuotaError: You exceeded
 *      your current quota …`, then
 *   2. emits a `result` with `status: "error"`, but whose `error` object is a
 *      generic `{ type: "unknown", message: "[API Error: …]" }` — the actual
 *      reason is NOT in the JSON.
 * The old parser ignored the plain-text line and collapsed *every* `result` to a
 * bare `end`, so the turn ended with no output and no error — a silent stop. We
 * now surface the rich plain-text reason as a classified `end.error`, and fall
 * back to the (generic) `result.error` / non-success status if the text dump is
 * ever absent. A defensive `error`-event branch is also kept for CLI versions /
 * configs that emit one as JSON.
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
import {
  classifyAgentError,
  extractErrorMessage,
  resolveAgentError,
} from "../../utils/errors"

/**
 * Conservative match for Gemini's plain-text fatal line (the failure never made
 * it into the JSON stream). Deliberately narrow so the harmless "YOLO mode is
 * enabled" banner — which is also non-JSON — is never mistaken for an error.
 */
const GEMINI_ERROR_LINE =
  /^error[:\s]|\b(quota exceeded|insufficient\s+balance|resource_exhausted|permission_denied)\b/i

/**
 * Strip noise from Gemini's plain-text error line before it reaches the user:
 * the "Full report available at: <sandbox tmp path>" fragment points at a file
 * inside a throwaway sandbox, so it is useless to surface.
 */
function cleanGeminiErrorLine(line: string): string {
  return line.replace(/Full report available at:\s*\S+\s*/i, "").trim()
}

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
  status?: string
  /** Present when the turn failed; shape mirrors json-mode `{ type, message, code }`. */
  error?: unknown
}

/** Standalone error event (API/system error; may be fatal or a warning). */
interface GeminiErrorEvent {
  type: "error"
  message?: string
  code?: string | number
  error?: unknown
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
  | GeminiErrorEvent
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
    // Non-JSON line. Most are the harmless YOLO banner; a fatal failure that
    // never reached the JSON stream prints a plain-text error line instead.
    const trimmed = line.trim()
    if (!context.state.geminiEnded && GEMINI_ERROR_LINE.test(trimmed)) {
      context.state.geminiEnded = true
      return { type: "end", error: resolveAgentError(cleanGeminiErrorLine(trimmed), "gemini") }
    }
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

  // Standalone error event. Per the headless docs these can be non-fatal
  // ("Non-fatal warnings and system errors"), so we normally stash the detail
  // and let the terminal `result` event decide. But a *recognized* fatal error
  // (quota, auth, balance, unavailable model) may be the last line before a
  // clean process exit with no `result` — surface it now so the turn never ends
  // silently.
  if (json.type === "error") {
    const payload = json.error ?? json
    const message = resolveAgentError(payload, "gemini")
    context.state.geminiError = message
    const category = classifyAgentError(extractErrorMessage(payload)).category
    if (!context.state.geminiEnded && category !== "unknown") {
      context.state.geminiEnded = true
      return { type: "end", error: message }
    }
    return null
  }

  // Result event — marks turn completion. A non-"success" status (or an attached
  // error object, or a stashed error event) means the turn failed; emit the
  // classified detail rather than a bare end that looks like a silent success.
  if (json.type === "result") {
    if (context.state.geminiEnded) return null
    const failed =
      typeof json.status === "string" && json.status.toLowerCase() !== "success"
    const stashed =
      typeof context.state.geminiError === "string"
        ? (context.state.geminiError as string)
        : undefined
    if (failed || json.error != null || stashed) {
      context.state.geminiEnded = true
      const error =
        json.error != null
          ? resolveAgentError(json.error, "gemini")
          : (stashed ?? `Gemini ended with status "${json.status ?? "error"}"`)
      return { type: "end", error }
    }
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
