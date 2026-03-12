import type { Event, ProviderCommand, ProviderName, RunOptions } from "../types/index.js"
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

type CodexEvent =
  | CodexThreadStarted
  | CodexMessageDelta
  | CodexToolStart
  | CodexToolInputDelta
  | CodexToolEnd
  | CodexTurnCompleted

/**
 * OpenAI Codex provider
 *
 * Interacts with the Codex CLI tool which outputs JSON lines
 */
export class CodexProvider extends Provider {
  readonly name: ProviderName = "codex"

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    if (this.sessionId || options?.sessionId) {
      args.push("resume", this.sessionId || options!.sessionId!)
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

    return null
  }
}
