import type { Event, ProviderCommand, ProviderName, ProviderOptions, RunOptions } from "../types/index.js"
import { createToolStartEvent } from "../types/events.js"
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

/** Emitted when a tool finishes (--format json / stream-json) */
interface OpenCodeToolUse {
  type: "tool_use"
  sessionID: string
  part?: {
    id: string
    tool?: string
    state?: { status: string }
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
  | OpenCodeToolUse
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
    // OpenCode sometimes writes JSON events to stderr; run under bash and redirect 2>&1
    // to ensure the sandbox PTY captures the JSONL stream.
    const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

    const model = options?.model
    const session = this.sessionId || options?.sessionId
    const prompt = options?.prompt

    const parts: string[] = [
      "opencode",
      "run",
      "--format",
      "json",
      "--variant",
      "medium",
    ]

    if (model) {
      parts.push("-m", quote(model))
    }

    if (session) {
      parts.push("-s", quote(session))
    }

    if (prompt) {
      parts.push(quote(prompt))
    }

    const command = `${parts.join(" ")} 2>&1`

    return {
      cmd: "bash",
      args: ["-lc", command],
      env: {
        // Allow all tool actions without interactive approval in headless runs
        OPENCODE_PERMISSION: '{"*":"allow"}',
        ...options?.env,
      },
    }
  }

  parse(line: string): Event | null {
    const json = safeJsonParse<OpenCodeEvent>(line)
    if (!json) {
      return null
    }

    // Step start - session initialization
    if (json.type === "step_start") {
      // OpenCode can emit multiple step_start lines for the same session; only emit once.
      if (this.sessionId === json.sessionID) return null
      this.sessionId = json.sessionID
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
      const toolName = (json.part?.tool || "unknown").toLowerCase()
      const normalized = toolName === "bash" ? "shell" : toolName
      return createToolStartEvent(normalized, json.part?.args)
    }

    // Tool use (stream-json: emitted when tool completes; emit as tool_start so it appears in stream)
    if (json.type === "tool_use") {
      const toolName = (json.part?.tool || "unknown").toLowerCase()
      const normalized = toolName === "bash" ? "shell" : toolName
      const raw = json.part as { state?: { input?: unknown } } | undefined
      return createToolStartEvent(normalized, raw?.state?.input)
    }

    // Tool result - tool completed
    if (json.type === "tool_result") {
      return { type: "tool_end" }
    }

    // Step finish - emit end only when run actually stops (reason "stop"); ignore intermediate steps (e.g. reason "tool-calls").
    if (json.type === "step_finish") {
      if (json.part?.reason === "stop") return { type: "end" }
      return null
    }

    // Error event - emit as end with error
    if (json.type === "error") {
      const errorMsg = json.error?.data?.message || json.error?.name || "Unknown error"
      return { type: "end", error: errorMsg }
    }

    return null
  }
}
