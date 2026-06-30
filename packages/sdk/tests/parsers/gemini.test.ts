/**
 * Parser tests for parseGeminiLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseGeminiLine, GEMINI_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

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

  // ─── Failure handling ──────────────────────────────────────────────────────

  it("ends with a classified error when a recognized fatal error event arrives", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "error",
        message: "[429] You exceeded your current quota — RESOURCE_EXHAUSTED",
        code: 429,
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "end" })
    expect((event as { error?: string }).error).toContain("exceeded your current quota")
    // rate-limit category appends an actionable hint
    expect((event as { error?: string }).error).toContain("retry")
  })

  it("stashes a non-fatal error event and surfaces it on the failing result", () => {
    const ctx = createContext()
    // An error with no recognizable category should not end the turn on its own…
    const mid = parseGeminiLine(
      JSON.stringify({ type: "error", message: "transient backend warning" }),
      mappings,
      ctx
    )
    expect(mid).toBeNull()
    // …but the terminal result carries it through instead of a silent end.
    const end = parseGeminiLine(
      JSON.stringify({ type: "result", status: "error", stats: {} }),
      mappings,
      ctx
    )
    expect(end).toEqual({ type: "end", error: "transient backend warning" })
  })

  it("ends with the error object detail when result.status is not success", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      JSON.stringify({
        type: "result",
        status: "error",
        error: { type: "ApiError", code: 429, message: "insufficient balance" },
        stats: {},
      }),
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "end" })
    expect((event as { error?: string }).error).toContain("insufficient balance")
    expect((event as { error?: string }).error).toContain("add credits")
  })

  it("does not treat the YOLO banner line as an error", () => {
    const ctx = createContext()
    expect(
      parseGeminiLine("YOLO mode is enabled. All tool calls will be automatically approved.", mappings, ctx)
    ).toBeNull()
  })

  it("recognizes a plain-text fatal line that never reached the JSON stream", () => {
    const ctx = createContext()
    const event = parseGeminiLine(
      "Error: quota exceeded for model gemini-2.5-pro (RESOURCE_EXHAUSTED)",
      mappings,
      ctx
    )
    expect(event).toMatchObject({ type: "end" })
    expect((event as { error?: string }).error).toContain("quota exceeded")
  })

  // ─── Fixture-driven ──────────────────────────────────────────────────────

  it("pro-model-on-free-key stream: surfaces a classified quota error (not a silent end)", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/gemini-error.jsonl"),
      "utf-8"
    )
    const ctx = createContext()
    const events = fixture
      .split("\n")
      .filter(Boolean)
      .map((l: string) => parseGeminiLine(l, mappings, ctx))
      .filter(Boolean)
      .flat() as { type: string; error?: string }[]
    const ends = events.filter((e) => e.type === "end")
    // Exactly one end, and it carries the failure detail + an actionable hint…
    expect(ends).toHaveLength(1)
    expect(ends[0].error).toContain("exceeded your current quota")
    expect(ends[0].error).toMatch(/add credits|retry/)
    // …with the useless sandbox tmp-file path stripped out.
    expect(ends[0].error).not.toContain("Full report available at")
  })
})

