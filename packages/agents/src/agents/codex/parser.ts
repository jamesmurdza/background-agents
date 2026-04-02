/**
 * Codex CLI output parser
 *
 * Pure function for parsing Codex CLI JSON output.
 * Supports both legacy item.tool.* and current item.started/item.completed formats.
 */

import type { Event } from "../../types/events.js"
import type { ShellToolInput, WriteToolInput } from "../../types/events.js"
import { createToolStartEvent } from "../../core/tools.js"
import { safeJsonParse } from "../../utils/json.js"
import { normalizeCodexToolName } from "./tools.js"

/**
 * Raw event types from Codex's JSON stream
 */
interface CodexThreadStarted {
  type: "thread.started"
  thread_id: string
}

interface CodexMessageDelta {
  type: "item.message.delta"
  text: string
}

interface CodexItemCompleted {
  type: "item.completed"
  item: {
    id: string
    type: string
    text?: string
    command?: string
    aggregated_output?: string
    exit_code?: number | null
    status?: string
    changes?: Array<{ path: string; kind: string }>
    tool?: string
    arguments?: unknown
    result?: {
      content?: Array<{ type: string; text?: string }>
      structured_content?: unknown
    }
  }
}

interface CodexItemStarted {
  type: "item.started"
  item: {
    id: string
    type: string
    command?: string
    status?: string
    tool?: string
    arguments?: unknown
  }
}

interface CodexToolStart {
  type: "item.tool.start"
  name: string
}

interface CodexToolInputDelta {
  type: "item.tool.input.delta"
  text: string
}

interface CodexToolEnd {
  type: "item.tool.end"
}

interface CodexTurnCompleted {
  type: "turn.completed"
}

interface CodexTurnFailed {
  type: "turn.failed"
  error: {
    message: string
  }
}

interface CodexError {
  type: "error"
  message: string
}

type CodexEvent =
  | CodexThreadStarted
  | CodexMessageDelta
  | CodexItemCompleted
  | CodexItemStarted
  | CodexToolStart
  | CodexToolInputDelta
  | CodexToolEnd
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexError

/**
 * Parse a line of Codex CLI output into event(s).
 */
export function parseCodexLine(
  line: string,
  toolMappings: Record<string, string>
): Event | Event[] | null {
  const json = safeJsonParse<CodexEvent>(line)
  if (!json) {
    return null
  }

  // Thread/session start
  if (json.type === "thread.started") {
    return { type: "session", id: json.thread_id }
  }

  // Message text delta
  if (json.type === "item.message.delta") {
    return { type: "token", text: json.text }
  }

  // Item completed (full message)
  if (
    json.type === "item.completed" &&
    json.item?.type === "agent_message" &&
    json.item?.text
  ) {
    return { type: "token", text: json.item.text }
  }

  // Item started - tool/action beginning (current Codex schema)
  if (json.type === "item.started" && json.item) {
    const it = json.item
    const name = normalizeCodexToolName(it.type, it.tool)
    let input: unknown
    if (it.type === "command_execution" && it.command != null) {
      input = { command: it.command } satisfies ShellToolInput
    } else if (it.type === "file_change") {
      input = {}
    } else if (it.type === "mcp_tool_call" && it.arguments != null) {
      input = it.arguments
    } else {
      input = undefined
    }
    return createToolStartEvent(name, input, toolMappings)
  }

  // Item completed - tool/action result (current Codex schema)
  if (json.type === "item.completed" && json.item) {
    const it = json.item
    if (it.type === "command_execution" && it.aggregated_output !== undefined) {
      return { type: "tool_end", output: it.aggregated_output }
    }
    if (it.type === "mcp_tool_call") {
      let output: string | undefined
      if (it.result?.content?.length && it.result.content[0]?.text) {
        output = it.result.content[0].text
      } else if (it.result) {
        output = JSON.stringify(it.result)
      }
      return { type: "tool_end", output }
    }
    // file_change: emit tool_start then tool_end (Codex only sends item.completed)
    if (it.type === "file_change" && it.changes && it.changes.length > 0) {
      const c = it.changes[0]
      const input: WriteToolInput = {
        file_path: c.path,
        kind: c.kind as "add" | "update",
        content: null,
      }
      return [
        createToolStartEvent("write", input, toolMappings),
        { type: "tool_end", output: JSON.stringify(it.changes) },
      ]
    }
    return null
  }

  // Tool start (legacy)
  if (json.type === "item.tool.start") {
    return createToolStartEvent(
      normalizeCodexToolName("mcp_tool_call", json.name),
      undefined,
      toolMappings
    )
  }

  // Tool input delta (legacy)
  if (json.type === "item.tool.input.delta") {
    return { type: "tool_delta", text: json.text }
  }

  // Tool end (legacy)
  if (json.type === "item.tool.end") {
    return { type: "tool_end" }
  }

  // Turn complete
  if (json.type === "turn.completed") {
    return { type: "end" }
  }

  // Turn failed - emit end event with error
  if (json.type === "turn.failed") {
    return { type: "end", error: json.error?.message }
  }

  // Error event - emit as end with error
  if (json.type === "error") {
    return { type: "end", error: json.message }
  }

  return null
}
