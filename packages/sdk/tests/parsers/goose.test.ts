/**
 * Parser tests for parseGooseLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseGooseLine, GOOSE_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

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

  // Goose wraps provider failures in an assistant message ("Ran into this
  // error: …") + a plain `complete`, not a {type:"error"} event. The wrapped
  // detail must surface on the terminal end rather than pass as normal text.
  it("surfaces a wrapped provider error on complete instead of a silent end", () => {
    const ctx = createContext()
    const mid = parseGooseLine(
      JSON.stringify({
        type: "message",
        message: {
          id: null,
          role: "assistant",
          created: 1,
          content: [
            {
              type: "text",
              text:
                "Ran into this error: Request failed: Bad request (400): Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits..\n\nPlease retry if you think this is a transient or recoverable error.",
            },
          ],
        },
      }),
      mappings,
      ctx
    )
    // The wrapper text is not emitted as ordinary assistant output…
    expect(mid).toBeNull()
    // …it rides through to the terminal end as a classified error.
    const end = parseGooseLine(JSON.stringify({ type: "complete", total_tokens: null }), mappings, ctx)
    expect(end).toMatchObject({ type: "end" })
    expect((end as { error?: string }).error).toContain("credit balance is too low")
    expect((end as { error?: string }).error).toContain("add credits")
  })

  it("no-credit fixture: surfaces the billing failure (not a silent end)", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/goose-error.jsonl"),
      "utf-8"
    )
    const ctx = createContext()
    const events = fixture
      .split("\n")
      .filter(Boolean)
      .map((l: string) => parseGooseLine(l, mappings, ctx))
      .filter(Boolean)
      .flat() as { type: string; error?: string }[]
    const ends = events.filter((e) => e.type === "end")
    expect(ends).toHaveLength(1)
    expect(ends[0].error).toContain("credit balance is too low")
  })
})

