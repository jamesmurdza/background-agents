/**
 * Kimi CLI output parser
 *
 * Kimi Code's `--output-format stream-json` emits one complete chat-completion
 * style message per line (NOT Claude's stream-json shape):
 *
 *   {"role":"assistant","content":"…","tool_calls":[
 *       {"type":"function","id":"Bash_0",
 *        "function":{"name":"Bash","arguments":"{\"command\":\"ls\"}"}}]}
 *   {"role":"tool","tool_call_id":"Bash_0","content":"…"}
 *   {"role":"meta","type":"session.resume_hint","session_id":"session_…", …}
 *
 * The trailing `meta`/session.resume_hint line is the end-of-turn marker and the
 * only place the session id appears.
 */

import type { Event } from "../../types/events"
import { createToolStartEvent } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"

interface KimiToolCall {
  type?: string
  id?: string
  function?: { name?: string; arguments?: string }
}

interface KimiLine {
  role?: "assistant" | "tool" | "meta" | "user" | "system"
  type?: string
  content?: string
  tool_calls?: KimiToolCall[]
  tool_call_id?: string
  session_id?: string
}

export function parseKimiLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<KimiLine>(line)
  if (!json) return null

  // End-of-turn marker — also carries the resumable session id.
  if (json.role === "meta") {
    if (json.type === "session.resume_hint") {
      const events: Event[] = []
      if (json.session_id) events.push({ type: "session", id: json.session_id })
      events.push({ type: "end" })
      return events
    }
    return null
  }

  // Tool result line.
  if (json.role === "tool") {
    return { type: "tool_end", output: json.content }
  }

  // Assistant turn: optional text content followed by zero or more tool calls.
  if (json.role === "assistant") {
    const events: Event[] = []
    if (json.content) {
      events.push({ type: "token", text: json.content })
    }
    for (const call of json.tool_calls ?? []) {
      const name = call.function?.name
      if (!name) continue
      const input = safeJsonParse<unknown>(call.function?.arguments ?? "") ?? {}
      events.push(createToolStartEvent(name, input, toolMappings))
    }
    if (events.length === 0) return null
    return events.length === 1 ? events[0] : events
  }

  return null
}
