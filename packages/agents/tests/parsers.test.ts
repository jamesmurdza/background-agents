/**
 * Parser tests - these test pure data transformations from agent-specific
 * event formats to our standard Event format. No mocks, no I/O - just input/output.
 */
import { describe, it, expect } from "vitest"
import {
  parseClaudeLine,
  parseCodexLine,
  parseElizaLine,
  parseGeminiLine,
  parseGooseLine,
  parseKiloLine,
  parseOpencodeLine,
  parsePiLine,
  CLAUDE_TOOL_MAPPINGS,
  CODEX_TOOL_MAPPINGS,
  ELIZA_TOOL_MAPPINGS,
  GEMINI_TOOL_MAPPINGS,
  GOOSE_TOOL_MAPPINGS,
  KILO_TOOL_MAPPINGS,
  OPENCODE_TOOL_MAPPINGS,
  PI_TOOL_MAPPINGS,
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

  it("parses message event (current format) for assistant text", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "message", role: "assistant", content: "2 + 2 equals 4.", delta: true }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "2 + 2 equals 4." })
  })

  it("ignores message event for user role", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "message", role: "user", content: "Please do X." }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses result event (current format) as end", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "result", status: "success", stats: {} }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses tool_use event (current format) as tool_start", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "tool_use",
        tool_name: "run_shell_command",
        tool_id: "abc123",
        parameters: { command: "ls", description: "List files" },
      }),
      mappings,
      ctx
    )
    // run_shell_command is not in GEMINI_TOOL_MAPPINGS, so it passes through normalized
    expect(event).toMatchObject({ type: "tool_start", name: "run_shell_command" })
  })

  it("parses tool_use for known tool and normalizes name", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "tool_use",
        tool_name: "execute_code",
        tool_id: "xyz789",
        parameters: { command: "echo hi" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "shell", input: { command: "echo hi" } })
  })

  it("parses tool_result event (current format) with output", () => {
    const ctx = createContext()
    // First emit a tool_use to track the tool_id
    parseGeminiLine(
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", tool_id: "abc123", parameters: {} }),
      mappings,
      ctx
    )
    const event = parseGeminiLine(
      JSON.stringify({ type: "tool_result", tool_id: "abc123", status: "success", output: "hello.txt" }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "hello.txt" })
  })

  it("parses tool_result with no output (empty string) as undefined output", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({ type: "tool_result", tool_id: "noop", status: "success", output: "" }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: undefined })
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

describe("parsePiLine", () => {
  const mappings = PI_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parsePiLine("not json", mappings, ctx)).toBeNull()
    expect(parsePiLine("", mappings, ctx)).toBeNull()
  })

  it("parses session header event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      '{"type": "session", "version": 3, "id": "pi_session_123", "timestamp": "2025-01-01T00:00:00Z", "cwd": "/home/user"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "pi_session_123" })
  })

  it("parses message_update with text_delta using delta field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Hello from Pi!",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello from Pi!" })
  })

  it("parses message_update with text_delta using text field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "text_delta",
          text: "Alternative text",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Alternative text" })
  })

  it("returns null for message_update without text_delta", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "other_event",
        },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_execution_start event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_123",
        toolName: "bash",
        args: { command: "ls -la" },
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

  it("parses tool_execution_start event with read tool", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_456",
        toolName: "read",
        args: { file_path: "/path/to/file.ts" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_start",
      name: "read",
      input: { file_path: "/path/to/file.ts" },
    })
  })

  it("handles tool_execution_start with missing tool name", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tool_789",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_execution_update event with string result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "bash",
        partialResult: "partial output...",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_delta", text: "partial output..." })
  })

  it("parses tool_execution_update event with object result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "read",
        partialResult: { content: "file content" },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "tool_delta",
      text: '{"content":"file content"}',
    })
  })

  it("returns null for tool_execution_update without partialResult", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_update",
        toolCallId: "tool_123",
        toolName: "bash",
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_execution_end event with string result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "bash",
        result: "command output",
        isError: false,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: "command output" })
  })

  it("parses tool_execution_end event with object result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "read",
        result: { lines: 100 },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end", output: '{"lines":100}' })
  })

  it("parses tool_execution_end event without result", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tool_123",
        toolName: "write",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses agent_end event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "agent_end",
        messages: [],
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with error field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "error",
        error: "Rate limit exceeded",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Rate limit exceeded" })
  })

  it("parses error event with message field", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "error",
        message: "Connection failed",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Connection failed" })
  })

  it("parses auto_retry_end failure event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "auto_retry_end",
        success: false,
        attempt: 3,
        finalError: "Max retries exceeded",
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Max retries exceeded" })
  })

  it("returns null for auto_retry_end success event", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "auto_retry_end",
        success: true,
        attempt: 2,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for agent_start event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "agent_start"}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for turn_start event", () => {
    const ctx = createContext()
    expect(parsePiLine('{"type": "turn_start"}', mappings, ctx)).toBeNull()
  })

  it("returns null for turn_end event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "turn_end", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for message_start event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "message_start", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for message_end event", () => {
    const ctx = createContext()
    expect(
      parsePiLine('{"type": "message_end", "message": {}}', mappings, ctx)
    ).toBeNull()
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parsePiLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})

describe("parseElizaLine", () => {
  const mappings = ELIZA_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseElizaLine("not json", mappings)).toBeNull()
    expect(parseElizaLine("", mappings)).toBeNull()
    expect(parseElizaLine("{not valid json}", mappings)).toBeNull()
  })

  it("parses system init event", () => {
    const event = parseElizaLine(
      '{"type": "system", "subtype": "init", "session_id": "eliza-123"}',
      mappings
    )
    expect(event).toEqual({ type: "session", id: "eliza-123" })
  })

  it("parses assistant message with text", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "text", text: "Why do you say you are sad?" }],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Why do you say you are sad?" })
  })

  it("parses assistant message with tool_use (Write)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Write",
              input: { file_path: "/tmp/test.txt", content: "hello" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "write" })
  })

  it("parses assistant message with tool_use (Read)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "read" })
  })

  it("parses assistant message with tool_use (Bash)", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Bash",
              input: { command: "rm /tmp/file.txt" },
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
  })

  it("parses tool_result success", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "File written successfully",
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "File written successfully" })
  })

  it("parses tool_result error", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "Error: Permission denied" })
  })

  it("parses result success event", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Session complete",
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses result error event", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "No prompt provided",
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "No prompt provided" })
  })

  it("returns null for assistant message with empty content", () => {
    const event = parseElizaLine(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_123", content: [] },
        session_id: "eliza-123",
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("returns null for unknown event types", () => {
    expect(parseElizaLine('{"type": "unknown_event"}', mappings)).toBeNull()
  })
})

describe("parseKiloLine", () => {
  const mappings = KILO_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseKiloLine("not json", mappings, ctx)).toBeNull()
    expect(parseKiloLine("", mappings, ctx)).toBeNull()
  })

  it("parses step_start event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_start", "sessionID": "ses_kilo123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "ses_kilo123" })
  })

  it("deduplicates step_start for same session", () => {
    const ctx = createContext()
    parseKiloLine('{"type": "step_start", "sessionID": "ses_kilo123"}', mappings, ctx)
    const event = parseKiloLine('{"type": "step_start", "sessionID": "ses_kilo123"}', mappings, ctx)
    expect(event).toBeNull()
  })

  it("parses text event with content", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "text", "text": "Hello from Kilo!"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello from Kilo!" })
  })

  it("returns null for text event without text type", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "image"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for text event without text content", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "text", "sessionID": "ses_kilo123", "part": {"type": "text"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("drops reasoning events (internal thinking)", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "reasoning",
        sessionID: "ses_kilo123",
        part: { type: "reasoning", text: "Let me think about this..." },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_call event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_call", "sessionID": "ses_kilo123", "part": {"type": "tool-call", "tool": "write"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "write", input: {} })
  })

  it("normalizes bash tool to shell", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "tool_call",
        sessionID: "ses_kilo123",
        part: { type: "tool-call", tool: "bash", args: { command: "ls" } },
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
  })

  it("handles tool_call with missing tool name", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_call", "sessionID": "ses_kilo123", "part": {"type": "tool-call"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_use event with output as [tool_start, tool_end]", () => {
    const ctx = createContext()
    const events = parseKiloLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_kilo123",
        part: {
          id: "prt_123",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/tmp/test.txt" },
            output: "file contents here",
          },
        },
      }),
      mappings,
      ctx
    )
    expect(Array.isArray(events)).toBe(true)
    const arr = events as any[]
    expect(arr[0]).toMatchObject({ type: "tool_start", name: "read" })
    expect(arr[1]).toEqual({ type: "tool_end", output: "file contents here" })
  })

  it("parses tool_use event without output as tool_start only", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      JSON.stringify({
        type: "tool_use",
        sessionID: "ses_kilo123",
        part: {
          id: "prt_123",
          tool: "write",
          state: { status: "running", input: { filePath: "/tmp/out.txt" } },
        },
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "tool_start", name: "write" })
  })

  it("parses tool_result event", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "tool_result", "sessionID": "ses_kilo123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses step_finish with reason stop as end", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_finish", "sessionID": "ses_kilo123", "part": {"reason": "stop"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for step_finish with non-stop reason", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "step_finish", "sessionID": "ses_kilo123", "part": {"reason": "tool-calls"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses error event with error message", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "error", "sessionID": "ses_kilo123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "Rate limit exceeded" })
  })

  it("parses error event falling back to error name", () => {
    const ctx = createContext()
    const event = parseKiloLine(
      '{"type": "error", "sessionID": "ses_kilo123", "error": {"name": "APIError"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "APIError" })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseKiloLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })
})
