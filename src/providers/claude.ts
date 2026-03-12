import type { Event, ProviderCommand, ProviderName, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

/**
 * Raw event types from Claude's SSE stream
 */
interface ClaudeMessageStart {
  type: "message_start"
  message?: {
    id?: string
  }
}

interface ClaudeContentBlockStart {
  type: "content_block_start"
  content_block?: {
    type: string
    name?: string
  }
}

interface ClaudeContentBlockDelta {
  type: "content_block_delta"
  delta?: {
    type: string
    text?: string
    partial_json?: string
  }
}

interface ClaudeContentBlockStop {
  type: "content_block_stop"
}

interface ClaudeMessageStop {
  type: "message_stop"
}

type ClaudeEvent =
  | ClaudeMessageStart
  | ClaudeContentBlockStart
  | ClaudeContentBlockDelta
  | ClaudeContentBlockStop
  | ClaudeMessageStop

/**
 * Claude Code provider
 *
 * Interacts with the Claude CLI tool which outputs Server-Sent Events (SSE)
 */
export class ClaudeProvider extends Provider {
  readonly name: ProviderName = "claude"

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    // Add output format flag for JSON streaming
    args.push("--output-format", "stream-json")

    if (this.sessionId || options?.sessionId) {
      args.push("--resume", this.sessionId || options!.sessionId!)
    }

    return {
      cmd: "claude",
      args,
      env: options?.env,
    }
  }

  parse(line: string): Event | null {
    // Claude uses SSE format: "data: {...}"
    if (!line.startsWith("data:")) {
      return null
    }

    const jsonStr = line.slice(5).trim()
    const json = safeJsonParse<ClaudeEvent>(jsonStr)
    if (!json) {
      return null
    }

    // Session/message start
    if (json.type === "message_start") {
      const id = json.message?.id
      if (id) {
        return { type: "session", id }
      }
      return null
    }

    // Tool invocation start
    if (json.type === "content_block_start") {
      if (json.content_block?.type === "tool_use" && json.content_block.name) {
        return { type: "tool_start", name: json.content_block.name }
      }
      return null
    }

    // Content deltas (text or tool input)
    if (json.type === "content_block_delta") {
      if (json.delta?.type === "text_delta" && json.delta.text) {
        return { type: "token", text: json.delta.text }
      }
      if (json.delta?.type === "input_json_delta" && json.delta.partial_json) {
        return { type: "tool_delta", text: json.delta.partial_json }
      }
      return null
    }

    // Content block stop (tool end)
    if (json.type === "content_block_stop") {
      return { type: "tool_end" }
    }

    // Message complete
    if (json.type === "message_stop") {
      return { type: "end" }
    }

    return null
  }
}
