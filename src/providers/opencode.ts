import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

/**
 * Raw event types from OpenCode's JSON stream
 */
interface OpenCodeStepStart {
  type: "step_start"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "step-start"
  }
}

interface OpenCodeText {
  type: "text"
  sessionID: string
  part?: {
    id: string
    sessionID: string
    messageID: string
    type: "text"
    text?: string
  }
}

interface OpenCodeToolCall {
  type: "tool_call"
  sessionID: string
  part?: {
    id: string
    type: "tool-call"
    tool?: string
    args?: unknown
  }
}

interface OpenCodeToolResult {
  type: "tool_result"
  sessionID: string
  part?: {
    id: string
    type: "tool-result"
  }
}

interface OpenCodeStepFinish {
  type: "step_finish"
  sessionID: string
  part?: {
    id: string
    type: "step-finish"
    reason: string
  }
}

interface OpenCodeError {
  type: "error"
  sessionID: string
  error?: {
    name: string
    data?: {
      message: string
    }
  }
}

type OpenCodeEvent =
  | OpenCodeStepStart
  | OpenCodeText
  | OpenCodeToolCall
  | OpenCodeToolResult
  | OpenCodeStepFinish
  | OpenCodeError

/**
 * OpenCode provider
 *
 * Interacts with the OpenCode CLI tool which outputs JSON lines
 */
export class OpenCodeProvider extends Provider {
  readonly name: ProviderName = "opencode"

  constructor(options: ProviderOptions) {
    super(options)
  }

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = ["run", "--format", "json"]

    // Add model (default to gpt-4o which works reliably)
    const model = options?.model || "openai/gpt-4o"
    args.push("-m", model)

    if (this.sessionId || options?.sessionId) {
      args.push("-s", this.sessionId || options!.sessionId!)
    }

    // Add the prompt if provided
    if (options?.prompt) {
      args.push(options.prompt)
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

    // Step start - session initialization
    if (json.type === "step_start") {
      return { type: "session", id: json.sessionID }
    }

    // Text content - the actual response
    if (json.type === "text") {
      if (json.part?.type === "text" && json.part.text) {
        return { type: "token", text: json.part.text }
      }
      return null
    }

    // Tool call start
    if (json.type === "tool_call") {
      const toolName = json.part?.tool || "unknown"
      return { type: "tool_start", name: toolName }
    }

    // Tool result - tool completed
    if (json.type === "tool_result") {
      return { type: "tool_end" }
    }

    // Step finish - completion
    if (json.type === "step_finish") {
      return { type: "end" }
    }

    // Error event - log and continue
    if (json.type === "error") {
      const errorMsg = json.error?.data?.message || json.error?.name || "Unknown error"
      console.error("[OpenCode Error]", errorMsg)
      return { type: "end" }
    }

    return null
  }
}
