import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

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
  | CodexToolStart
  | CodexToolInputDelta
  | CodexToolEnd
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexError

/**
 * OpenAI Codex provider
 *
 * Interacts with the Codex CLI tool which outputs JSON lines
 */
export class CodexProvider extends Provider {
  readonly name: ProviderName = "codex"

  constructor(options: ProviderOptions) {
    super(options)
  }

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    // Use exec subcommand for non-interactive mode with JSON output
    args.push("exec")

    // JSON output for streaming events
    args.push("--json")

    // Skip git repo check for sandbox environments
    args.push("--skip-git-repo-check")

    // Add model if specified (e.g., "gpt-4o", "o1", "o3")
    if (options?.model) {
      args.push("--model", options.model)
    }

    if (this.sessionId || options?.sessionId) {
      // For resuming, we need a different command structure
      args.push("resume", this.sessionId || options!.sessionId!)
    } else if (options?.prompt) {
      // Add the prompt
      args.push(options.prompt)
    }

    return {
      cmd: "codex",
      args,
      env: options?.env,
    }
  }

  parse(line: string): Event | null {
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
    if (json.type === "item.completed" && json.item?.text) {
      return { type: "token", text: json.item.text }
    }

    // Tool start
    if (json.type === "item.tool.start") {
      return { type: "tool_start", name: json.name }
    }

    // Tool input delta
    if (json.type === "item.tool.input.delta") {
      return { type: "tool_delta", text: json.text }
    }

    // Tool end
    if (json.type === "item.tool.end") {
      return { type: "tool_end" }
    }

    // Turn complete
    if (json.type === "turn.completed") {
      return { type: "end" }
    }

    // Turn failed - treat as end with error info logged
    if (json.type === "turn.failed") {
      console.error("[Codex Error]", json.error?.message)
      return { type: "end" }
    }

    // Error event - log and continue
    if (json.type === "error") {
      console.error("[Codex Error]", json.message)
      return null
    }

    return null
  }
}
