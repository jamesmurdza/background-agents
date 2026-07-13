/**
 * Parser tests for parseClaudeLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseClaudeLine, CLAUDE_TOOL_MAPPINGS } from "../../src/agents/index.js"

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

  // Provider failures (e.g. billing) can arrive as a result with subtype
  // "success" but is_error: true — it must still end with a classified error,
  // not look like a clean success.
  it("ends with a classified error when result.is_error is true (subtype success)", () => {
    const event = parseClaudeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Credit balance is too low",
        session_id: "abc-123",
      }),
      mappings
    )
    expect(event).toMatchObject({ type: "end" })
    expect((event as { error?: string }).error).toContain("Credit balance is too low")
    // "credit balance" classifies as a balance failure and appends a hint
    expect((event as { error?: string }).error).toContain("add credits")
  })

  it("no-credit fixture: surfaces the billing failure (not a silent end)", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/claude-error.jsonl"),
      "utf-8"
    )
    const events = fixture
      .split("\n")
      .filter(Boolean)
      .map((l: string) => parseClaudeLine(l, mappings))
      .filter(Boolean)
      .flat() as { type: string; error?: string }[]
    const ends = events.filter((e) => e.type === "end")
    expect(ends).toHaveLength(1)
    expect(ends[0].error).toContain("Credit balance is too low")
  })
})

