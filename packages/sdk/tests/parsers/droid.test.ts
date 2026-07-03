/**
 * Parser tests for parseDroidLine. droid exec emits its OWN stream-json
 * (system/init, message, reasoning, tool_call, tool_result, completion) plus a
 * distinct {type:"error"} fatal event — NOT the Claude shape. The success and
 * error fixtures are captured from / modeled on real droid runs. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import {
  parseDroidLine,
  DROID_TOOL_MAPPINGS,
  droidAgent,
} from "../../src/agents/index.js"
import type { Event } from "../../src/types/events.js"

const mappings = DROID_TOOL_MAPPINGS
const flat = (ev: Event | Event[] | null): Event[] =>
  ev == null ? [] : Array.isArray(ev) ? ev : [ev]

describe("droidAgent.buildCommand", () => {
  const script = (model?: string, sessionId?: string) =>
    droidAgent.buildCommand({ prompt: "hi", model, sessionId }).args[1]

  // `quote()` wraps individual args, so assert on token presence, not adjacency.
  it("BYOK: writes settings.json and selects the custom model id", () => {
    const s = script("claude-sonnet-4-5-20250929")
    expect(s).toContain(".factory/settings.json")
    expect(s).toContain("custom:byok-0") // both the settings entry and the -m target
  })

  it("Factory-hosted: passes the raw catalog id and writes NO settings.json", () => {
    const s = script("factory/claude-opus-4-8")
    expect(s).toContain("claude-opus-4-8") // raw built-in id as the -m target
    expect(s).not.toContain("settings.json")
    expect(s).not.toContain("custom:byok-0")
    expect(s).not.toContain("factory/") // prefix is stripped before -m
  })

  it("resumes via --fork (never -s), for both paths", () => {
    for (const [model, sid] of [
      ["claude-haiku-4-5", "sess-1"],
      ["factory/gpt-5.5", "sess-2"],
    ] as const) {
      const s = script(model, sid)
      expect(s).toContain("--fork")
      expect(s).toContain(sid)
      expect(s).not.toContain("--session-id")
    }
  })
})

describe("parseDroidLine", () => {
  it("returns null for non-JSON, non-error lines", () => {
    expect(parseDroidLine("not json", mappings)).toBeNull()
    expect(parseDroidLine("", mappings)).toBeNull()
    // The log-path line droid prints after an error must be ignored.
    expect(
      parseDroidLine("See log: /home/daytona/.factory/logs/droid.log", mappings)
    ).toBeNull()
  })

  it("emits a session event from the system/init line", () => {
    expect(
      parseDroidLine(
        '{"type":"system","subtype":"init","session_id":"sess_abc","model":"claude-opus-4-8"}',
        mappings
      )
    ).toEqual({ type: "session", id: "sess_abc" })
  })

  it("emits a token from an assistant message, ignores the user echo + reasoning", () => {
    expect(
      parseDroidLine('{"type":"message","role":"assistant","text":"Hi"}', mappings)
    ).toEqual({ type: "token", text: "Hi" })
    expect(
      parseDroidLine('{"type":"message","role":"user","text":"the prompt"}', mappings)
    ).toBeNull()
    expect(
      parseDroidLine('{"type":"reasoning","text":"internal thinking"}', mappings)
    ).toBeNull()
  })

  it("maps droid tool_call names to canonical tool_start events", () => {
    expect(
      parseDroidLine(
        '{"type":"tool_call","toolName":"Execute","parameters":{"command":"ls"}}',
        mappings
      )
    ).toEqual({ type: "tool_start", name: "shell", input: { command: "ls" } })
    expect(
      parseDroidLine(
        '{"type":"tool_call","toolName":"Create","parameters":{"file_path":"/a.txt","content":"x"}}',
        mappings
      )
    ).toEqual({
      type: "tool_start",
      name: "write",
      input: { file_path: "/a.txt", content: "x" },
    })
    // Unmapped droid tools fall through as a lowercased passthrough name.
    expect(flat(parseDroidLine('{"type":"tool_call","toolName":"LS","parameters":{"directory_path":"/"}}', mappings))[0]).toMatchObject({
      type: "tool_start",
      name: "ls",
    })
  })

  it("emits tool_end (with stringified output) from a tool_result", () => {
    expect(
      parseDroidLine(
        '{"type":"tool_result","toolId":"Create","isError":false,"value":"TODO List Updated"}',
        mappings
      )
    ).toEqual({ type: "tool_end", output: "TODO List Updated" })
  })

  it("ends on completion WITHOUT re-emitting finalText (it echoes prior messages)", () => {
    // finalText duplicates the streamed assistant messages, so it must NOT become
    // a token — otherwise the whole reply renders twice.
    const ev = parseDroidLine(
      '{"type":"completion","finalText":"All done.","numTurns":5}',
      mappings
    )
    expect(ev).toEqual({ type: "end" })
  })

  it("surfaces a JSON error event as a classified end-error (not a silent crash)", () => {
    const ev = parseDroidLine(
      '{"type":"error","source":"cli","message":"Error: Authentication failed. Please set a valid FACTORY_API_KEY.","session_id":"x"}',
      mappings
    ) as { type: string; error?: string }
    expect(ev.type).toBe("end")
    expect(ev.error).toContain("Authentication failed")
    expect(ev.error).toContain("check the API key")
  })

  // ─── Fixture-driven (captured from real droid runs) ──────────────────────

  it("success stream: parses the reference fixture into tokens, tools and one end", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/droid.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const tokens: string[] = []
    const types: string[] = []
    let sessionId: string | undefined
    for (const line of lines) {
      for (const e of flat(parseDroidLine(line, mappings))) {
        types.push(e.type)
        if (e.type === "token") tokens.push((e as { text: string }).text)
        if (e.type === "session") sessionId = (e as { id: string }).id
      }
    }
    // Session id comes from the init line (a real BYOK run: model custom:byok-0).
    const initSessionId = JSON.parse(lines[0]).session_id
    expect(sessionId).toBe(initSessionId)
    expect(sessionId).toBeTruthy()
    expect(types).toContain("tool_start")
    expect(types).toContain("tool_end")
    expect(tokens.length).toBeGreaterThan(0)
    expect(types.filter((t) => t === "end")).toHaveLength(1)
  })

  it("gemini BYOK success stream: also parses into tokens, tools and one end", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/droid-gemini.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const types: string[] = []
    for (const line of lines) {
      for (const e of flat(parseDroidLine(line, mappings))) types.push(e.type)
    }
    expect(types).toContain("session")
    expect(types).toContain("tool_start")
    expect(types.filter((t) => t === "end")).toHaveLength(1)
  })

  it("fatal error stream: surfaces a classified auth error (not a silent crash)", () => {
    const fs = require("fs")
    const path = require("path")
    const fixture = fs.readFileSync(
      path.join(__dirname, "../fixtures/jsonl-reference/droid-error.jsonl"),
      "utf-8"
    )
    const lines = fixture.split("\n").filter(Boolean)
    const events = lines
      .map((l: string) => parseDroidLine(l, mappings))
      .flatMap(flat) as { type: string; error?: string }[]
    const end = events.find((e) => e.type === "end")
    expect(end).toBeDefined()
    expect(end!.error).toContain("invalid api key")
    expect(end!.error).toContain("check the API key")
  })
})
