/**
 * Parser tests for parsePiLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parsePiLine, PI_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

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

  // ─── Provider-failure handling ─────────────────────────────────────────────
  // Pi carries provider failures (auth, balance, quota, …) on an assistant
  // message with stopReason "error" + errorMessage, riding on message_end /
  // turn_end / agent_end — NOT as a standalone {type:"error"} event. Without
  // special handling agent_end looked like a silent success and the failure was
  // never surfaced or logged.

  it("surfaces a classified provider error carried on agent_end's messages", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage:
              '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
          },
        ],
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "end" })
    expect((event as { error?: string }).error).toContain("credit balance is too low")
    // balance category appends an actionable hint
    expect((event as { error?: string }).error).toContain("add credits")
  })

  it("surfaces an error stashed on message_end when agent_end has no messages", () => {
    const ctx = createContext()
    // The failing assistant message arrives first on message_end…
    expect(
      parsePiLine(
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage: "429 quota exceeded" },
        }),
        mappings,
        ctx
      )
    ).toBeNull()
    // …and the terminal agent_end (no messages) still carries it through.
    const end = parsePiLine(JSON.stringify({ type: "agent_end" }), mappings, ctx)
    expect(end).toMatchObject({ type: "end" })
    expect((end as { error?: string }).error).toContain("quota exceeded")
  })

  it("emits a clean end (no error) for a successful agent_end", () => {
    const ctx = createContext()
    const event = parsePiLine(
      JSON.stringify({
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }],
      }),
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("emits exactly one end across Pi's per-retry agent_end events", () => {
    const ctx = createContext()
    const errored = {
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 RESOURCE_EXHAUSTED" }],
    }
    const first = parsePiLine(JSON.stringify(errored), mappings, ctx)
    const second = parsePiLine(JSON.stringify(errored), mappings, ctx)
    expect(first).toMatchObject({ type: "end" })
    expect((first as { error?: string }).error).toContain("RESOURCE_EXHAUSTED")
    // Retry attempts each emit their own agent_end; downstream takes the first
    // `end`, so later ones must be suppressed rather than duplicated.
    expect(second).toBeNull()
  })

  // ─── Fixture-driven (real captured Pi runs) ────────────────────────────────

  const parseFixture = (name: string) => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, `../fixtures/jsonl-reference/${name}.jsonl`),
      "utf-8"
    )
    const ctx = createContext()
    return fixture
      .split("\n")
      .filter(Boolean)
      .map((l: string) => parsePiLine(l, mappings, ctx))
      .filter(Boolean)
      .flat() as { type: string; error?: string }[]
  }

  it.each([
    ["pi-anthropic-error", /credit balance is too low/, /add credits/],
    ["pi-openai-error", /exceeded your current quota/, /add credits/],
    ["pi-gemini-error", /exceeded your current quota/, /add credits|retry/],
  ])("%s: surfaces a single classified provider error (not a silent end)", (name, detail, hint) => {
    const events = parseFixture(name as string)
    const ends = events.filter((e) => e.type === "end")
    expect(ends).toHaveLength(1)
    expect(ends[0].error).toBeDefined()
    expect(ends[0].error).toMatch(detail as RegExp)
    expect(ends[0].error).toMatch(hint as RegExp)
  })

  it("pi-gemini (success): ends cleanly with no error", () => {
    const events = parseFixture("pi-gemini")
    const ends = events.filter((e) => e.type === "end")
    expect(ends).toHaveLength(1)
    expect(ends[0].error).toBeUndefined()
  })
})

