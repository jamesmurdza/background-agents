import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { createToolStartEvent } from "../types/events.js"
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

interface GeminiMessage {
  type: "message"
  role: string
  content: string
  delta?: boolean
}

interface GeminiResult {
  type: "result"
  status: string
}

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
  | GeminiToolStart
  | GeminiToolDelta
  | GeminiToolEnd
  | GeminiAssistantComplete

// Map Gemini CLI tool names to canonical set (same as Claude/Codex)
const GEMINI_TOOL_NAME_MAP: Record<string, string> = {
  execute_code: "shell",
  run_command: "shell",
  bash: "shell",
  write_file: "write",
  read_file: "read",
  apply_patch: "edit",
  glob_file_search: "glob",
  grep_search: "grep",
}

function normalizeGeminiToolName(name: string): string {
  const lower = name.toLowerCase()
  return GEMINI_TOOL_NAME_MAP[lower] ?? GEMINI_TOOL_NAME_MAP[name] ?? lower
}

/**
 * Google Gemini CLI provider
 *
 * Interacts with the Gemini CLI tool which outputs JSON lines
 */
export class GeminiProvider extends Provider {
  readonly name: ProviderName = "gemini"
  /** Accumulated tool output between tool.start and tool.end */
  private toolOutputBuffer = ""

  constructor(options: ProviderOptions) {
    super(options)
  }

  getCommand(options?: RunOptions): ProviderCommand {
    const args: string[] = []

    // Stream JSON for event parsing
    args.push("--output-format", "stream-json")

    // Add model if specified (e.g., "gemini-2.0-flash", "gemini-1.5-pro")
    if (options?.model) {
      args.push("--model", options.model)
    }

    if (this.sessionId || options?.sessionId) {
      args.push("--resume", this.sessionId || options!.sessionId!)
    }

    // Add prompt with -p flag if provided
    if (options?.prompt) {
      args.push("-p", options.prompt)
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

    // Assistant text delta (legacy format)
    if (json.type === "assistant.delta") {
      return { type: "token", text: json.text }
    }

    // Message event (new format)
    if (json.type === "message") {
      if (json.role === "assistant" && json.content) {
        return { type: "token", text: json.content }
      }
      // Skip user messages
      return null
    }

    // Result event (new format) - marks completion
    if (json.type === "result") {
      return { type: "end" }
    }

    // Tool start
    if (json.type === "tool.start") {
      this.toolOutputBuffer = ""
      const name = normalizeGeminiToolName(json.name)
      return createToolStartEvent(name, json.input)
    }

    // Tool delta (streaming tool input or output)
    if (json.type === "tool.delta") {
      this.toolOutputBuffer += json.text
      return { type: "tool_delta", text: json.text }
    }

    // Tool end
    if (json.type === "tool.end") {
      const output = this.toolOutputBuffer.trim() || undefined
      this.toolOutputBuffer = ""
      return { type: "tool_end", output }
    }

    // Assistant complete (legacy format)
    if (json.type === "assistant.complete") {
      return { type: "end" }
    }

    return null
  }
}
