import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

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
  subtype: "success" | "error"
  result?: string
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
}

type ClaudeEvent =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeResult
  | ClaudeToolUse
  | ClaudeToolResult

/**
 * Claude Code CLI provider
 *
 * Interacts with the Claude CLI tool which outputs JSON lines in stream-json format
 */
export class ClaudeProvider extends Provider {
  readonly name: ProviderName = "claude"

  constructor(options: ProviderOptions) {
    super(options)
  }

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    // Print mode for non-interactive usage
    args.push("-p")

    // Add output format flag for JSON streaming (requires --verbose)
    args.push("--output-format", "stream-json", "--verbose")

    if (this.sessionId || options?.sessionId) {
      args.push("--resume", this.sessionId || options!.sessionId!)
    }

    // Add the prompt if provided
    if (options?.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "claude",
      args,
      env: options?.env,
    }
  }

  parse(line: string): Event | null {
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
            return { type: "tool_start", name: block.name }
          }
        }
      }
      return null
    }

    // Tool use event
    if (json.type === "tool_use" && "name" in json) {
      return { type: "tool_start", name: json.name }
    }

    // Tool result marks end of tool use
    if (json.type === "tool_result") {
      return { type: "tool_end" }
    }

    // Result event marks end of interaction
    if (json.type === "result") {
      return { type: "end" }
    }

    return null
  }
}
