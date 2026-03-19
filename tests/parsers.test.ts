/**
 * Parser tests - these test pure data transformations from provider-specific
 * event formats to our standard Event format. No mocks, no I/O - just input/output.
 */
import { describe, it, expect } from "vitest"
import { ClaudeProvider } from "../src/providers/claude.js"
import { CodexProvider } from "../src/providers/codex.js"
import { GeminiProvider } from "../src/providers/gemini.js"
import { OpenCodeProvider } from "../src/providers/opencode.js"

// All providers created with dangerouslyAllowLocalExecution for parser testing only
const claude = new ClaudeProvider({ dangerouslyAllowLocalExecution: true })
const codex = new CodexProvider({ dangerouslyAllowLocalExecution: true })
const gemini = new GeminiProvider({ dangerouslyAllowLocalExecution: true })
const opencode = new OpenCodeProvider({ dangerouslyAllowLocalExecution: true })

describe("ClaudeProvider.parse", () => {
  it("returns null for invalid JSON", () => {
    expect(claude.parse("not json")).toBeNull()
    expect(claude.parse("")).toBeNull()
    expect(claude.parse("{not valid json}")).toBeNull()
  })

  it("parses system init event", () => {
    const event = claude.parse(
      '{"type": "system", "subtype": "init", "session_id": "abc-123"}'
    )
    expect(event).toEqual({ type: "session", id: "abc-123" })
  })

  it("parses assistant message with text", () => {
    const event = claude.parse(JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_123",
        content: [{ type: "text", text: "Hello from Claude!" }]
      },
      session_id: "abc-123"
    }))
    expect(event).toEqual({ type: "token", text: "Hello from Claude!" })
  })

  it("parses assistant message with tool_use", () => {
    const event = claude.parse(JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_123",
        content: [{ type: "tool_use", name: "read_file" }]
      },
      session_id: "abc-123"
    }))
    expect(event).toEqual({ type: "tool_start", name: "read_file" })
  })

  it("returns null for assistant message with empty content", () => {
    const event = claude.parse(JSON.stringify({
      type: "assistant",
      message: { id: "msg_123", content: [] },
      session_id: "abc-123"
    }))
    expect(event).toBeNull()
  })

  it("parses tool_use event", () => {
    const event = claude.parse('{"type": "tool_use", "name": "bash"}')
    expect(event).toEqual({ type: "tool_start", name: "bash" })
  })

  it("parses tool_result event", () => {
    const event = claude.parse('{"type": "tool_result", "tool_use_id": "tool_123"}')
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses result event", () => {
    const event = claude.parse(
      '{"type": "result", "subtype": "success", "result": "Done", "session_id": "abc-123"}'
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    expect(claude.parse('{"type": "unknown_event"}')).toBeNull()
  })
})

describe("CodexProvider.parse", () => {
  it("returns null for invalid JSON", () => {
    expect(codex.parse("not json")).toBeNull()
    expect(codex.parse("")).toBeNull()
  })

  it("parses thread.started event", () => {
    const event = codex.parse('{"type": "thread.started", "thread_id": "thread_abc"}')
    expect(event).toEqual({ type: "session", id: "thread_abc" })
  })

  it("parses item.message.delta event", () => {
    const event = codex.parse('{"type": "item.message.delta", "text": "Hello"}')
    expect(event).toEqual({ type: "token", text: "Hello" })
  })

  it("parses item.tool.start event", () => {
    const event = codex.parse('{"type": "item.tool.start", "name": "shell"}')
    expect(event).toEqual({ type: "tool_start", name: "shell" })
  })

  it("parses item.tool.input.delta event", () => {
    const event = codex.parse('{"type": "item.tool.input.delta", "text": "ls -la"}')
    expect(event).toEqual({ type: "tool_delta", text: "ls -la" })
  })

  it("parses item.tool.end event", () => {
    const event = codex.parse('{"type": "item.tool.end"}')
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses turn.completed event", () => {
    const event = codex.parse('{"type": "turn.completed"}')
    expect(event).toEqual({ type: "end" })
  })

  it("parses turn.failed event with error", () => {
    const event = codex.parse('{"type": "turn.failed", "error": {"message": "API rate limit exceeded"}}')
    expect(event).toEqual({ type: "end", error: "API rate limit exceeded" })
  })

  it("parses error event with message", () => {
    const event = codex.parse('{"type": "error", "message": "unexpected status 401 Unauthorized"}')
    expect(event).toEqual({ type: "end", error: "unexpected status 401 Unauthorized" })
  })

  it("returns null for unknown event types", () => {
    expect(codex.parse('{"type": "unknown.event"}')).toBeNull()
  })
})

describe("GeminiProvider.parse", () => {
  it("returns null for invalid JSON", () => {
    expect(gemini.parse("not json")).toBeNull()
    expect(gemini.parse("")).toBeNull()
  })

  it("parses init event", () => {
    const event = gemini.parse('{"type": "init", "session_id": "gemini_session"}')
    expect(event).toEqual({ type: "session", id: "gemini_session" })
  })

  it("parses assistant.delta event", () => {
    const event = gemini.parse('{"type": "assistant.delta", "text": "Sure, I can help"}')
    expect(event).toEqual({ type: "token", text: "Sure, I can help" })
  })

  it("parses tool.start event and normalizes name", () => {
    const event = gemini.parse('{"type": "tool.start", "name": "execute_code"}')
    expect(event).toEqual({ type: "tool_start", name: "shell", input: undefined })
  })

  it("parses tool.delta event", () => {
    const event = gemini.parse('{"type": "tool.delta", "text": "running..."}')
    expect(event).toEqual({ type: "tool_delta", text: "running..." })
  })

  it("parses tool.end event with accumulated output", () => {
    // Create a fresh provider instance for stateful test
    const g = new GeminiProvider({ dangerouslyAllowLocalExecution: true })
    g.parse('{"type": "tool.start", "name": "write_file"}')
    g.parse('{"type": "tool.delta", "text": "done"}')
    const event = g.parse('{"type": "tool.end"}')
    expect(event).toEqual({ type: "tool_end", output: "done" })
  })

  it("parses assistant.complete event", () => {
    const event = gemini.parse('{"type": "assistant.complete"}')
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    expect(gemini.parse('{"type": "unknown"}')).toBeNull()
  })
})

describe("OpenCodeProvider.parse", () => {
  it("returns null for invalid JSON", () => {
    expect(opencode.parse("not json")).toBeNull()
    expect(opencode.parse("")).toBeNull()
  })

  it("parses step_start event", () => {
    const event = opencode.parse('{"type": "step_start", "sessionID": "ses_xyz123"}')
    expect(event).toEqual({ type: "session", id: "ses_xyz123" })
  })

  it("parses text event with content", () => {
    const event = opencode.parse(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text", "text": "Processing..."}}'
    )
    expect(event).toEqual({ type: "token", text: "Processing..." })
  })

  it("returns null for text event without text type", () => {
    const event = opencode.parse(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "image"}}'
    )
    expect(event).toBeNull()
  })

  it("returns null for text event without text content", () => {
    const event = opencode.parse(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text"}}'
    )
    expect(event).toBeNull()
  })

  it("parses tool_call event", () => {
    const event = opencode.parse(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call", "tool": "write_file"}}'
    )
    expect(event).toEqual({ type: "tool_start", name: "write_file" })
  })

  it("handles tool_call with missing tool name", () => {
    const event = opencode.parse(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call"}}'
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown" })
  })

  it("parses tool_result event", () => {
    const event = opencode.parse('{"type": "tool_result", "sessionID": "ses_xyz123"}')
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses step_finish event", () => {
    const event = opencode.parse(
      '{"type": "step_finish", "sessionID": "ses_xyz123", "part": {"reason": "stop"}}'
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with error message", () => {
    const event = opencode.parse(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}'
    )
    expect(event).toEqual({ type: "end", error: "Rate limit exceeded" })
  })

  it("parses error event falling back to error name", () => {
    const event = opencode.parse(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError"}}'
    )
    expect(event).toEqual({ type: "end", error: "APIError" })
  })

  it("returns null for unknown event types", () => {
    expect(opencode.parse('{"type": "unknown"}')).toBeNull()
  })
})
