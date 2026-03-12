import type { Event, ProviderCommand, ProviderName, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

/**
 * Raw event types from OpenCode's JSON stream
 */
interface OpenCodeRunStarted {
  type: "run.started"
  run_id: string
}

interface OpenCodeMessagePartUpdated {
  type: "message.part.updated"
  part?: {
    type: string
    text?: string
  }
}

interface OpenCodeToolStart {
  type: "tool.start"
  tool: string
}

interface OpenCodeToolInputDelta {
  type: "tool.input.delta"
  text: string
}

interface OpenCodeToolCompleted {
  type: "tool.completed"
}

interface OpenCodeRunCompleted {
  type: "run.completed"
}

type OpenCodeEvent =
  | OpenCodeRunStarted
  | OpenCodeMessagePartUpdated
  | OpenCodeToolStart
  | OpenCodeToolInputDelta
  | OpenCodeToolCompleted
  | OpenCodeRunCompleted

/**
 * OpenCode provider
 *
 * Interacts with the OpenCode CLI tool which outputs JSON lines
 */
export class OpenCodeProvider extends Provider {
  readonly name: ProviderName = "opencode"

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = ["run", "--format", "json"]

    if (this.sessionId || options?.sessionId) {
      args.push("-s", this.sessionId || options!.sessionId!)
    }

    return {
      cmd: "opencode",
      args,
      env: options?.env,
    }
  }

  parse(line: string): Event | null {
    const json = safeJsonParse<OpenCodeEvent>(line)
    if (!json) {
      return null
    }

    // Run/session start
    if (json.type === "run.started") {
      return { type: "session", id: json.run_id }
    }

    // Message text update
    if (json.type === "message.part.updated") {
      if (json.part?.type === "text" && json.part.text) {
        return { type: "token", text: json.part.text }
      }
      return null
    }

    // Tool start
    if (json.type === "tool.start") {
      return { type: "tool_start", name: json.tool }
    }

    // Tool input delta
    if (json.type === "tool.input.delta") {
      return { type: "tool_delta", text: json.text }
    }

    // Tool completed
    if (json.type === "tool.completed") {
      return { type: "tool_end" }
    }

    // Run complete
    if (json.type === "run.completed") {
      return { type: "end" }
    }

    return null
  }
}
