/**
 * Parser tests - these test pure data transformations from agent-specific
 * event formats to our standard Event format. No mocks, no I/O - just input/output.
 */
import { describe, it, expect } from "vitest"
import {
  parseClaudeLine,
  parseCodexLine,
  parseGeminiLine,
  parseGooseLine,
  parseOpencodeLine,
  CLAUDE_TOOL_MAPPINGS,
  CODEX_TOOL_MAPPINGS,
  GEMINI_TOOL_MAPPINGS,
  GOOSE_TOOL_MAPPINGS,
  OPENCODE_TOOL_MAPPINGS,
} from "../src/agents/index.js"
import type { ParseContext } from "../src/core/agent.js"

// Helper to create a fresh parse context
function createContext(): ParseContext {
  return { state: {}, sessionId: null }
}

describe("parseClaudeLine", () => {
  const mappings = CLAUDE_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseClaudeLine("not json", mappings)).toBeNull()
    expect(parseClaudeLine("", mappings)).toBeNull()
    expect(parseClaudeLine("{not valid json}", mappings)).toBeNull()
  })

  it("parses system init event", () => {
    const event = parseClaudeLine(
      '{"type": "system", "subtype": "init", "session_id": "abc-123"}',
      mappings
    )
    expect(event).toEqual({ type: "session", id: "abc-123" })
  })

  it("parses assistant message with text", () => {
    const event = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "text", text: "Hello from Claude!" }],
        },
        session_id: "abc-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello from Claude!" })
  })

  it("parses assistant message with tool_use", () => {
    const event = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "tool_use", name: "read_file" }],
        },
        session_id: "abc-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_start", name: "read_file", input: {} })
  })

  it("returns null for assistant message with empty content", () => {
    const event = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_123", content: [] },
        session_id: "abc-123",
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("parses tool_use event", () => {
    const event = parseClaudeLine('{"type": "tool_use", "name": "bash"}', mappings)
    expect(event).toEqual({ type: "tool_start", name: "bash", input: {} })
  })

  it("parses tool_result event", () => {
    const event = parseClaudeLine(
      '{"type": "tool_result", "tool_use_id": "tool_123"}',
      mappings
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses result event", () => {
    const event = parseClaudeLine(
      '{"type": "result", "subtype": "success", "result": "Done", "session_id": "abc-123"}',
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    expect(parseClaudeLine('{"type": "unknown_event"}', mappings)).toBeNull()
  })
})

describe("parseCodexLine", () => {
  const mappings = CODEX_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseCodexLine("not json", mappings)).toBeNull()
    expect(parseCodexLine("", mappings)).toBeNull()
  })

  it("parses thread.started event", () => {
    const event = parseCodexLine(
      '{"type": "thread.started", "thread_id": "thread_abc"}',
      mappings
    )
    expect(event).toEqual({ type: "session", id: "thread_abc" })
  })

  it("parses item.message.delta event", () => {
    const event = parseCodexLine(
      '{"type": "item.message.delta", "text": "Hello"}',
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello" })
  })

  it("parses item.tool.start event", () => {
    const event = parseCodexLine(
      '{"type": "item.tool.start", "name": "shell"}',
      mappings
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: {} })
  })

  it("parses item.tool.input.delta event", () => {
    const event = parseCodexLine(
      '{"type": "item.tool.input.delta", "text": "ls -la"}',
      mappings
    )
    expect(event).toEqual({ type: "tool_delta", text: "ls -la" })
  })

  it("parses item.tool.end event", () => {
    const event = parseCodexLine('{"type": "item.tool.end"}', mappings)
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses turn.completed event", () => {
    const event = parseCodexLine('{"type": "turn.completed"}', mappings)
    expect(event).toEqual({ type: "end" })
  })

  it("parses turn.failed event with error", () => {
    const event = parseCodexLine(
      '{"type": "turn.failed", "error": {"message": "API rate limit exceeded"}}',
      mappings
    )
    expect(event).toEqual({ type: "end", error: "API rate limit exceeded" })
  })

  it("parses error event with message", () => {
    const event = parseCodexLine(
      '{"type": "error", "message": "unexpected status 401 Unauthorized"}',
      mappings
    )
    expect(event).toEqual({ type: "end", error: "unexpected status 401 Unauthorized" })
  })

  it("returns null for unknown event types", () => {
    expect(parseCodexLine('{"type": "unknown.event"}', mappings)).toBeNull()
  })
})

describe("parseGeminiLine", () => {
  const mappings = GEMINI_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseGeminiLine("not json", mappings, ctx)).toBeNull()
    expect(parseGeminiLine("", mappings, ctx)).toBeNull()
  })

  it("parses init event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "init", "session_id": "gemini_session"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "gemini_session" })
  })

  it("parses assistant.delta event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "assistant.delta", "text": "Sure, I can help"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Sure, I can help" })
  })

  it("parses tool.start event and normalizes name", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "tool.start", "name": "execute_code"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: {} })
  })

  it("parses tool.delta event", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      '{"type": "tool.delta", "text": "running..."}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_delta", text: "running..." })
  })

  it("parses tool.end event with accumulated output", () => {
    const ctx = createContext()
    parseGeminiLine('{"type": "tool.start", "name": "write_file"}', mappings, ctx)
    parseGeminiLine('{"type": "tool.delta", "text": "done"}', mappings, ctx)
    const event = parseGeminiLine('{"type": "tool.end"}', mappings, ctx)
    expect(event).toEqual({ type: "tool_end", output: "done" })
  })

  it("parses assistant.complete event", () => {
    const ctx = createContext()
    const event = parseGeminiLine('{"type": "assistant.complete"}', mappings, ctx)
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseGeminiLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

describe("parseOpencodeLine", () => {
  const mappings = OPENCODE_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseOpencodeLine("not json", mappings, ctx)).toBeNull()
    expect(parseOpencodeLine("", mappings, ctx)).toBeNull()
  })

  it("parses step_start event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "step_start", "sessionID": "ses_xyz123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "ses_xyz123" })
  })

  it("parses text event with content", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text", "text": "Processing..."}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Processing..." })
  })

  it("returns null for text event without text type", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "image"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for text event without text content", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_call event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call", "tool": "write_file"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "write_file", input: {} })
  })

  it("handles tool_call with missing tool name", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_result event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_result", "sessionID": "ses_xyz123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses step_finish event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "step_finish", "sessionID": "ses_xyz123", "part": {"reason": "stop"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with error message", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Rate limit exceeded" })
  })

  it("parses error event falling back to error name", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "APIError" })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseOpencodeLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

describe("parseGooseLine", () => {
  const mappings = GOOSE_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseGooseLine("not json", mappings, ctx)).toBeNull()
    expect(parseGooseLine("", mappings, ctx)).toBeNull()
    expect(parseGooseLine("{not valid json}", mappings, ctx)).toBeNull()
  })

  it("parses message event with assistant text content and emits session", () => {
    const ctx = createContext()
    const events = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-123",
          role: "assistant",
          created: 1738803195,
          content: [{ type: "text", text: "Hello from Goose!" }],
          metadata: { userVisible: true, agentVisible: true },
        },
      }),
      mappings,
      ctx
    )
    // First message emits both session and token events
    expect(events).toEqual([
      { type: "session", id: "chatcmpl-123" },
      { type: "token", text: "Hello from Goose!" },
    ])
    expect(ctx.sessionId).toBe("chatcmpl-123")
  })

  it("does not emit session event on subsequent messages", () => {
    const ctx = createContext()
    // First message
    parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-123",
          role: "assistant",
          created: 1738803195,
          content: [{ type: "text", text: "First" }],
        },
      }),
      mappings,
      ctx
    )
    // Second message
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-456",
          role: "assistant",
          created: 1738803196,
          content: [{ type: "text", text: "Second" }],
        },
      }),
      mappings,
      ctx
    )
    // Should only emit token, not session
    expect(event).toEqual({ type: "token", text: "Second" })
  })

  it("returns null for user message events", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: null,
          role: "user",
          created: 1738803195,
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses message event with tool_use", () => {
    const ctx = createContext()
    ctx.state.sessionEmitted = true // Skip session emission
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-123",
          role: "assistant",
          created: 1738803195,
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "developer__shell",
              input: { command: "ls -la" },
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_start",
      name: "shell",
      input: { command: "ls -la" },
    })
  })

  it("parses message event with tool_result success", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: null,
          role: "user",
          created: 1738803195,
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "file1.txt\nfile2.txt" })
  })

  it("parses message event with tool_result string content", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: null,
          role: "user",
          created: 1738803195,
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "simple string output",
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "simple string output" })
  })

  it("parses message event with tool_result error", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: null,
          role: "user",
          created: 1738803195,
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "Command failed with exit code 1",
              is_error: true,
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_end",
      output: "Error: Command failed with exit code 1",
    })
  })

  it("parses multiple content blocks in one message", () => {
    const ctx = createContext()
    ctx.state.sessionEmitted = true // Skip session emission
    const events = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-123",
          role: "assistant",
          created: 1738803195,
          content: [
            { type: "text", text: "Let me check that for you." },
            {
              type: "tool_use",
              id: "toolu_456",
              name: "developer__text_editor",
              input: { file: "test.txt" },
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    expect(events).toEqual([
      { type: "token", text: "Let me check that for you." },
      { type: "tool_start", name: "edit", input: { file: "test.txt" } },
    ])
  })

  it("parses complete event", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "complete",
        total_tokens: 1250,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses complete event with null tokens", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "complete",
        total_tokens: null,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with string error", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "error",
        error: "API rate limit exceeded",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "API rate limit exceeded" })
  })

  it("parses error event with object error", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      JSON.stringify({
        type: "error",
        error: { message: "Authentication failed", code: "auth_error" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Authentication failed" })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseGooseLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })

  it("strips SSE data prefix", () => {
    const ctx = createContext()
    const event = parseGooseLine(
      'data: {"type": "complete", "total_tokens": 100}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("handles real goose output format", () => {
    const ctx = createContext()
    ctx.state.sessionEmitted = true // Skip session emission for this test
    // Actual output from goose run --output-format stream-json
    const event = parseGooseLine(
      '{"type":"message","message":{"id":"chatcmpl-abc123","role":"assistant","created":1775249366,"content":[{"type":"text","text":"4"}],"metadata":{"userVisible":true,"agentVisible":true}}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "4" })
  })

  it("works without context for backward compatibility", () => {
    // Without context, session event is not emitted
    const event = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: "chatcmpl-123",
          role: "assistant",
          created: 1738803195,
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello" })
  })
})
