/**
 * Parser tests - these test pure data transformations from agent-specific
 * event formats to our standard Event format. No mocks, no I/O - just input/output.
 */
import { describe, it, expect } from "vitest"
import {
  parseClaudeLine,
  parseCodexLine,
  parseCopilotLine,
  parseElizaLine,
  parseGeminiLine,
  parseGooseLine,
  parseKiloLine,
  parseKimiLine,
  parseOpencodeLine,
  parsePiLine,
  CLAUDE_TOOL_MAPPINGS,
  CODEX_TOOL_MAPPINGS,
  COPILOT_TOOL_MAPPINGS,
  ELIZA_TOOL_MAPPINGS,
  GEMINI_TOOL_MAPPINGS,
  GOOSE_TOOL_MAPPINGS,
  KILO_TOOL_MAPPINGS,
  KIMI_TOOL_MAPPINGS,
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
    expect(event).toEqual({
      type: "end",
      error: "API rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses error event with message", () => {
    const event = parseCodexLine(
      '{"type": "error", "message": "unexpected status 401 Unauthorized"}',
      mappings
    )
    expect(event).toEqual({
      type: "end",
      error: "unexpected status 401 Unauthorized — check the API key for this model in Settings",
    })
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
    // run_shell_command is mapped to "shell" in GEMINI_TOOL_MAPPINGS
    expect(event).toMatchObject({ type: "tool_start", name: "shell" })
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
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
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

  it("surfaces the raw payload (not 'Unknown error') when the error has no message or name", () => {
    // Regression: an OpenCode error event whose payload has neither
    // error.data.message nor error.name used to collapse to the useless string
    // "Unknown error". Now the raw fields survive — here a 402 status, which is
    // additionally classified as a balance problem.
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"statusCode": 402, "providerID": "opencode"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error:
        '{"statusCode":402,"providerID":"opencode"} — switch to a free model or add credits / an API key',
    })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseOpencodeLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })

  it("ignores plaintext logs that are not model-call errors", () => {
    const ctx = createContext()
    expect(parseOpencodeLine("INFO 2026-04-03 service=models.dev refreshing", mappings, ctx)).toBeNull()
    // A tool/bash ERROR must not end the turn — the agent can recover from it.
    expect(parseOpencodeLine("ERROR 2026-04-03 service=bash command failed", mappings, ctx)).toBeNull()
  })

  it("surfaces a repeated service=llm error log as a terminal end (retryable hang)", () => {
    // On a retryable model error OpenCode emits no JSON event — it retries with
    // unbounded backoff, logging only this plaintext line each attempt. Without
    // this the turn hangs forever on the generating spinner.
    const ctx = createContext()
    const llmError =
      'ERROR 2026-04-03T21:08:42 +1717ms service=llm providerID=anthropic modelID=claude-haiku-4-5 ' +
      'session.id=ses_x error={"error":{"name":"AI_APICallError",' +
      '"requestBodyValues":{"system":[{"type":"text","text":"prompt"}]},"statusCode":429,"isRetryable":true}}'

    // First failure: grace — give OpenCode one retry to recover.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toBeNull()
    // Second failure: it's stuck — surface the classified error and end the turn.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toEqual({
      type: "end",
      error: "AI_APICallError HTTP 429 — wait a moment and retry",
    })
    // Subsequent failures are not re-emitted.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toBeNull()
  })

  it("surfaces a service=session.processor error immediately with its message", () => {
    // The terminal, turn-level failure line. Highest signal — carries a
    // human-readable message and means the turn gave up. No grace: waiting for a
    // second line is what made the UI appear to hang.
    const ctx = createContext()
    const processorError =
      "ERROR 2026-06-20T15:51:44 +2ms service=session.processor " +
      "error=Monthly usage limit reached. Resets in 10 days. To continue using this model now, " +
      "enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go " +
      'stack="AI ...'
    expect(parseOpencodeLine(processorError, mappings, ctx)).toEqual({
      type: "end",
      error:
        "Monthly usage limit reached. Resets in 10 days. To continue using this model now, " +
        "enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go",
    })
    // Already terminated — later error lines are not re-emitted.
    expect(parseOpencodeLine(processorError, mappings, ctx)).toBeNull()
  })

  it("surfaces a logfmt 'stream error' for the main agent (agent=build) immediately", () => {
    // Production opencode writes structured logfmt — NOT the pretty `ERROR …`
    // format. The main model call fails once then hangs indefinitely, so we must
    // surface on the first agent=build line (there is no second one to wait for).
    const ctx = createContext()
    const buildError =
      'timestamp=2026-06-20T16:38:24.349Z level=ERROR run=3b5d38d5 message="stream error" ' +
      "providerID=opencode-go modelID=mimo-v2.5-pro session.id=ses_x small=false agent=build mode=primary " +
      'error.error="AI_APICallError: Monthly usage limit reached. Resets in 10 days. ' +
      'To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go"'
    expect(parseOpencodeLine(buildError, mappings, ctx)).toEqual({
      type: "end",
      error:
        "Monthly usage limit reached. Resets in 10 days. " +
        "To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go",
    })
  })

  it("ignores a logfmt 'stream error' from the title sidecar (agent=title/small=true)", () => {
    const ctx = createContext()
    const titleError =
      'timestamp=2026-06-20T16:38:30.455Z level=ERROR message="stream error" ' +
      "providerID=opencode-go modelID=mimo-v2.5-pro small=true agent=title mode=primary " +
      'error.error="AI_RetryError: Failed after 3 attempts. Last error: Monthly usage limit reached."'
    expect(parseOpencodeLine(titleError, mappings, ctx)).toBeNull()
  })

  it("ignores the title/summary sidecar's billing failure (false positive)", () => {
    // Title generation is a separate cheap-model call; on a Go-only key it 401s
    // with a CreditsError. That must NOT end the turn — the main model is fine.
    const ctx = createContext()
    const titleLlmError =
      "ERROR 2026-06-20T15:39:20 +1ms service=llm providerID=opencode modelID=big-pickle " +
      'error={"error":{"name":"AI_APICallError","requestBodyValues":{"model":"gpt-5-nano",' +
      '"input":[{"role":"developer","content":"You are a title generator. Output ONLY a title."}]},' +
      '"statusCode":401}}'
    // Even repeated, title-sidecar llm errors are skipped (never counted).
    expect(parseOpencodeLine(titleLlmError, mappings, ctx)).toBeNull()
    expect(parseOpencodeLine(titleLlmError, mappings, ctx)).toBeNull()
    // A session.prompt "failed to generate title" line is also ignored.
    expect(
      parseOpencodeLine(
        "ERROR 2026-06-20 service=session.prompt error=No output generated. failed to generate title",
        mappings,
        ctx
      )
    ).toBeNull()
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
    expect(event).toEqual({
      type: "end",
      error: "API rate limit exceeded — wait a moment and retry",
    })
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
    expect(event).toEqual({
      type: "end",
      error: "Authentication failed — check the API key for this model in Settings",
    })
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
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
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
    expect(event).toEqual({
      type: "end",
      error: "Connection failed — check connectivity and retry",
    })
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

describe("parseCopilotLine", () => {
  const mappings = COPILOT_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    expect(parseCopilotLine("not json", mappings)).toBeNull()
    expect(parseCopilotLine("", mappings)).toBeNull()
    expect(parseCopilotLine("{bad}", mappings)).toBeNull()
  })

  it("returns null for JSON without type field", () => {
    expect(parseCopilotLine('{"foo": "bar"}', mappings)).toBeNull()
  })

  it("parses session.start event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.start", sessionId: "sess-abc-123" }),
      mappings
    )
    expect(event).toEqual({ type: "session", id: "sess-abc-123" })
  })

  it("parses session.start with missing sessionId", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.start" }),
      mappings
    )
    expect(event).toEqual({ type: "session", id: "" })
  })

  it("parses message.delta event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "message.delta", content: "Hello world" }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "Hello world" })
  })

  it("parses assistant.message_delta event (alternate naming)", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "assistant.message_delta", deltaContent: "chunk" }),
      mappings
    )
    expect(event).toEqual({ type: "token", text: "chunk" })
  })

  it("returns null for message.delta with empty content", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "message.delta" }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("parses tool.call event with shell tool", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.call",
        name: "shell",
        arguments: { command: "ls -la" },
        callId: "call_001",
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "shell",
    })
  })

  it("parses tool.start event (alternate naming)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.start",
        name: "read_file",
        arguments: { file_path: "/src/main.ts" },
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "read",
    })
  })

  it("normalizes tool names through mappings", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.call",
        name: "create_file",
        arguments: { file_path: "/new.ts", content: "// new" },
      }),
      mappings
    )
    expect(event).toMatchObject({
      type: "tool_start",
      name: "write",
    })
  })

  it("parses tool.result event", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.result",
        callId: "call_001",
        result: "main.go\nREADME.md",
      }),
      mappings
    )
    expect(event).toEqual({
      type: "tool_end",
      output: "main.go\nREADME.md",
    })
  })

  it("parses tool.end event (alternate naming) with output field", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.end",
        output: "done",
      }),
      mappings
    )
    expect(event).toEqual({ type: "tool_end", output: "done" })
  })

  it("parses turn.end success", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "turn.end", status: "success" }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses turn.end with error status (string error)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "turn.end",
        status: "error",
        error: "Rate limit exceeded",
      }),
      mappings
    )
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses turn.end with error status (object error)", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "turn.end",
        status: "error",
        error: { message: "Something went wrong" },
      }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "Something went wrong" })
  })

  it("parses turn.end with non-success status but no error field", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "turn.end", status: "cancelled" }),
      mappings
    )
    expect(event).toEqual({ type: "end", error: "Turn ended with status: cancelled" })
  })

  it("ignores assistant.turn_end in autopilot mode (end comes from session.task_complete)", () => {
    // In autopilot mode the CLI fires a continuation turn after assistant.turn_end,
    // so the parser intentionally returns null here. The true terminal event is
    // session.task_complete. See parser comment for details.
    const event = parseCopilotLine(
      JSON.stringify({ type: "assistant.turn_end", status: "success" }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("parses session.shutdown as end event", () => {
    const event = parseCopilotLine(
      JSON.stringify({ type: "session.shutdown" }),
      mappings
    )
    expect(event).toEqual({ type: "end" })
  })

  it("returns null for unknown event types", () => {
    expect(
      parseCopilotLine('{"type": "permission.requested"}', mappings)
    ).toBeNull()
    expect(
      parseCopilotLine('{"type": "session.compaction"}', mappings)
    ).toBeNull()
  })

  it("suppresses internal autopilot tool: report_intent", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "report_intent", toolCallId: "call_ri_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses internal autopilot tool: ask_user", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "ask_user", toolCallId: "call_au_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses internal autopilot tool: task_complete", () => {
    const event = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "task_complete", toolCallId: "call_tc_001" },
      }),
      mappings
    )
    expect(event).toBeNull()
  })

  it("suppresses tool.execution_complete for a suppressed internal tool call ID", () => {
    const ctx = createContext()
    // Suppress the tool_start
    const startEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "report_intent", toolCallId: "call_ri_002" },
      }),
      mappings,
      ctx
    )
    expect(startEvent).toBeNull()

    // The paired tool_end should also be suppressed
    const endEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_complete",
        data: { toolCallId: "call_ri_002" },
      }),
      mappings,
      ctx
    )
    expect(endEvent).toBeNull()
  })

  it("does NOT suppress tool.execution_complete for a real tool call ID", () => {
    const ctx = createContext()
    // A real shell tool — should NOT be suppressed
    parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolName: "shell", toolCallId: "call_sh_001", arguments: { command: "ls" } },
      }),
      mappings,
      ctx
    )
    const endEvent = parseCopilotLine(
      JSON.stringify({
        type: "tool.execution_complete",
        data: { toolCallId: "call_sh_001", result: { content: "file.ts\n" } },
      }),
      mappings,
      ctx
    )
    expect(endEvent).toEqual({ type: "tool_end", output: "file.ts\n" })
  })

  // ─── assistant.message_delta ───────────────────────────────────────────────
  // The ephemeral flag is NOT the discriminator. Continuation state is.

  it("passes through assistant.message_delta (ephemeral: true) during the initial turn", () => {
    // gpt-5-mini marks ALL deltas ephemeral: true, including real responses.
    // Without a continuation flag set, the delta must be emitted.
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Dogs are loyal companions.", messageId: "msg-1" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Dogs are loyal companions." })
  })

  it("passes through assistant.message_delta (ephemeral: false) during the initial turn", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Hello!", messageId: "msg-2" },
        ephemeral: false,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Hello!" })
  })

  it("suppresses assistant.message_delta during autopilot continuation turn", () => {
    // session.info sets the continuation flag; subsequent deltas are narration.
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "Marking the task complete.", messageId: "msg-narrate" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  // ─── assistant.message ────────────────────────────────────────────────────

  it("emits text from assistant.message with no tool requests (gpt-4.1 final response)", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: {
          messageId: "msg-3",
          content: "Here is my final answer.",
          toolRequests: [],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Here is my final answer." })
  })

  it("emits text from assistant.message even when ephemeral: true (before continuation flag)", () => {
    // gpt-5-mini may mark assistant.message ephemeral. The ephemeral flag alone
    // must not suppress it — only the continuation state should.
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-5", content: "Here is my response.", toolRequests: [] },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Here is my response." })
  })

  it("suppresses assistant.message with tool requests (prelude to tool call)", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: {
          messageId: "msg-4",
          content: "Let me check the filesystem.",
          toolRequests: [{ toolCallId: "call_abc", name: "bash", type: "function" }],
        },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("suppresses assistant.message during autopilot continuation turn", () => {
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-cont", content: "Internal narration.", toolRequests: [] },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for assistant.message with empty content and no tool requests", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "assistant.message",
        data: { messageId: "msg-6", content: "", toolRequests: [] },
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  // ─── session.info ─────────────────────────────────────────────────────────

  it("session.info autopilot_continuation sets continuation flag and returns null", () => {
    const ctx = createContext()
    const event = parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "autopilot_continuation", message: "Continuing autonomously (1 premium request)" },
        ephemeral: true,
      }),
      mappings,
      ctx
    )
    expect(event).toBeNull()
    expect(ctx.state["copilot_in_autopilot_continuation"]).toBe(true)
  })

  it("session.info with other infoType does not set continuation flag", () => {
    const ctx = createContext()
    parseCopilotLine(
      JSON.stringify({
        type: "session.info",
        data: { infoType: "some_other_info", message: "something" },
      }),
      mappings,
      ctx
    )
    expect(ctx.state["copilot_in_autopilot_continuation"]).toBeUndefined()
  })

  // ─── Fixture-driven integration tests ────────────────────────────────────
  // Replay full JSONL streams and assert the correct token sequence.

  it("gpt-5-mini stream: emits response tokens from initial-turn deltas, suppresses continuation narration", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "fixtures/jsonl-reference/copilot-gpt-5-mini.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const ctx = createContext()
    const tokens: string[] = []
    const events: string[] = []
    for (const line of lines) {
      const event = parseCopilotLine(line, mappings, ctx)
      if (!event) continue
      if (event.type === "token") tokens.push((event as { type: "token"; text: string }).text)
      else events.push(event.type)
    }
    // Should have emitted the initial-turn deltas as tokens
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.join("")).toContain("Dogs")
    // No continuation narration ("Marking") should have leaked through
    expect(tokens.join("")).not.toContain("Mark")
    // Should have emitted exactly one end event (from session.task_complete)
    expect(events).toContain("end")
    expect(events.filter(e => e === "end")).toHaveLength(1)
  })

  it("gpt-4.1 stream: emits response from assistant.message, suppresses continuation turn", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "fixtures/jsonl-reference/copilot-gpt-4.1.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const ctx = createContext()
    const tokens: string[] = []
    const events: string[] = []
    for (const line of lines) {
      const event = parseCopilotLine(line, mappings, ctx)
      if (!event) continue
      if (event.type === "token") tokens.push((event as { type: "token"; text: string }).text)
      else events.push(event.type)
    }
    // Response content arrives via streaming deltas; assistant.message is
    // suppressed by the messageId dedup. The joined text must equal the full
    // response and must not be repeated (repetition bug).
    const fullText = tokens.join("")
    expect(fullText).toBe("Dogs are loyal and affectionate companions.")
    // No duplicate: the text appears exactly once
    expect(fullText.indexOf("Dogs")).toBe(0)
    expect(fullText.lastIndexOf("Dogs")).toBe(0)
    // One end event (result is suppressed since task_complete already fired)
    expect(events).toContain("end")
    expect(events.filter(e => e === "end")).toHaveLength(1)
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
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
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

describe("parseKimiLine", () => {
  const mappings = KIMI_TOOL_MAPPINGS

  it("returns null for non-JSON, non-error lines", () => {
    expect(parseKimiLine("not json", mappings)).toBeNull()
    expect(parseKimiLine("", mappings)).toBeNull()
    // The log-path line Kimi prints after an error must be ignored.
    expect(
      parseKimiLine("See log: /home/daytona/.kimi-code/logs/kimi-code.log", mappings)
    ).toBeNull()
  })

  it("emits token + tool_start events from an assistant message", () => {
    const event = parseKimiLine(
      '{"role":"assistant","content":"Hi","tool_calls":[{"type":"function","id":"Bash_0","function":{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}}]}',
      mappings
    )
    expect(event).toEqual([
      { type: "token", text: "Hi" },
      { type: "tool_start", name: "shell", input: { command: "ls" } },
    ])
  })

  it("emits tool_end from a tool result line", () => {
    expect(
      parseKimiLine('{"role":"tool","tool_call_id":"Bash_0","content":"ok"}', mappings)
    ).toEqual({ type: "tool_end", output: "ok" })
  })

  it("emits session + end from the resume_hint meta line", () => {
    expect(
      parseKimiLine(
        '{"role":"meta","type":"session.resume_hint","session_id":"session_abc"}',
        mappings
      )
    ).toEqual([{ type: "session", id: "session_abc" }, { type: "end" }])
  })

  // ─── Fixture-driven ──────────────────────────────────────────────────────

  it("success stream: parses the reference fixture into tokens, tools and one end", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "fixtures/jsonl-reference/kimi.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const tokens: string[] = []
    const types: string[] = []
    let sessionId: string | undefined
    for (const line of lines) {
      const ev = parseKimiLine(line, mappings)
      if (!ev) continue
      for (const e of Array.isArray(ev) ? ev : [ev]) {
        types.push(e.type)
        if (e.type === "token") tokens.push((e as { text: string }).text)
        if (e.type === "session") sessionId = (e as { id: string }).id
      }
    }
    expect(tokens.join("")).toContain("2 + 2 = 4")
    expect(types).toContain("tool_start")
    expect(types).toContain("tool_end")
    expect(sessionId).toMatch(/^session_/)
    expect(types.filter((t) => t === "end")).toHaveLength(1)
  })

  it("out-of-credits stream: surfaces a classified balance error (not a silent crash)", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "fixtures/jsonl-reference/kimi-error.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const events = lines
      .map((l: string) => parseKimiLine(l, mappings))
      .filter(Boolean)
      .flat() as { type: string; error?: string }[]
    const end = events.find((e) => e.type === "end")
    expect(end).toBeDefined()
    // The raw provider detail is preserved …
    expect(end!.error).toContain("insufficient balance")
    // … and an actionable hint is appended (balance category).
    expect(end!.error).toContain("add credits")
  })
})
