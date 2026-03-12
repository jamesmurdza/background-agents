import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { safeJsonParse } from "../utils/json.js"
import { Provider } from "./base.js"

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

interface GeminiToolStart {
  type: "tool.start"
  name: string
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
  | GeminiToolStart
  | GeminiToolDelta
  | GeminiToolEnd
  | GeminiAssistantComplete

/**
 * Google Gemini CLI provider
 *
 * Interacts with the Gemini CLI tool which outputs JSON lines
 */
export class GeminiProvider extends Provider {
  readonly name: ProviderName = "gemini"

  constructor(options: ProviderOptions) {
    super(options)
  }

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    // Add model if specified (e.g., "gemini-2.0-flash", "gemini-1.5-pro")
    if (options?.model) {
      args.push("--model", options.model)
    }

    if (this.sessionId || options?.sessionId) {
      args.push("--resume", this.sessionId || options!.sessionId!)
    }

    // Add the prompt if provided
    if (options?.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "gemini",
      args,
      env: options?.env,
    }
  }

  parse(line: string): Event | null {
    const json = safeJsonParse<GeminiEvent>(line)
    if (!json) {
      return null
    }

    // Session init
    if (json.type === "init") {
      return { type: "session", id: json.session_id }
    }

    // Assistant text delta
    if (json.type === "assistant.delta") {
      return { type: "token", text: json.text }
    }

    // Tool start
    if (json.type === "tool.start") {
      return { type: "tool_start", name: json.name }
    }

    // Tool delta
    if (json.type === "tool.delta") {
      return { type: "tool_delta", text: json.text }
    }

    // Tool end
    if (json.type === "tool.end") {
      return { type: "tool_end" }
    }

    // Assistant complete
    if (json.type === "assistant.complete") {
      return { type: "end" }
    }

    return null
  }
}
