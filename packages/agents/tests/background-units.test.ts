/**
 * Unit tests for the pure helpers extracted from background/session.ts.
 *
 * These run without a sandbox or API keys (unlike the integration suites in
 * tests/integration/*, which are skipped unless DAYTONA_API_KEY is set), so
 * they provide always-on coverage of command construction, crash synthesis,
 * progress detection, history formatting, and meta persistence.
 */
import { describe, it, expect } from "vitest"
import type { CodeAgentSandbox } from "../src/types/provider"
import type { SessionMeta } from "../src/background/types"
import { buildFullCommand, quoteArg } from "../src/background/command-string"
import { synthesizeCrashEvent } from "../src/background/crash"
import {
  withinStartupGrace,
  hasObservableBackgroundProgress,
  BACKGROUND_STARTUP_GRACE_MS,
} from "../src/background/progress"
import { formatHistory } from "../src/background/history"
import {
  parseMeta,
  metaUnchanged,
  readMeta,
  writeMeta,
} from "../src/background/meta-store"

describe("command-string", () => {
  it("quoteArg wraps in single quotes and escapes embedded quotes", () => {
    expect(quoteArg("hello")).toBe("'hello'")
    expect(quoteArg("it's")).toBe("'it'\\''s'")
  })

  it("buildFullCommand leaves cmd bare and quotes each arg", () => {
    expect(buildFullCommand({ cmd: "claude", args: ["-p", "hi there"] })).toBe(
      "claude '-p' 'hi there'"
    )
  })

  it("buildFullCommand inlines env vars as a quoted KEY=value prefix", () => {
    expect(
      buildFullCommand({ cmd: "x", args: [], env: { A: "1", B: "two words" } })
    ).toBe("A='1' B='two words' x")
  })

  it("buildFullCommand prepends a cd when cwd is set", () => {
    expect(buildFullCommand({ cmd: "x", args: ["a"], cwd: "/work" })).toBe(
      "cd '/work' && x 'a'"
    )
  })

  it("buildFullCommand escapes single quotes in cwd", () => {
    expect(buildFullCommand({ cmd: "x", args: [], cwd: "/a'b" })).toBe(
      "cd '/a'\\''b' && x"
    )
  })
})

describe("synthesizeCrashEvent", () => {
  it("recognises an unavailable Copilot model and gives an actionable message", () => {
    const ev = synthesizeCrashEvent(
      'Error: Model "claude-sonnet-4.5" from --model flag is not available.'
    )
    expect(ev.type).toBe("agent_crashed")
    expect(ev.message).toContain('"claude-sonnet-4.5"')
    expect(ev.message).toContain("not available")
    // The actionable branch carries no raw output.
    expect(ev.output).toBeUndefined()
  })

  it("falls back to a generic crash carrying the non-JSON output tail", () => {
    const ev = synthesizeCrashEvent("Traceback:\nboom\n")
    expect(ev.message).toContain("crashed or killed")
    expect(ev.output).toBe("Traceback:\nboom")
  })

  it("strips JSON lines, leaving output undefined when only JSON was emitted", () => {
    const ev = synthesizeCrashEvent('{"type":"token","text":"hi"}\n{"type":"x"}')
    expect(ev.output).toBeUndefined()
  })

  it("truncates the output tail to the last 4096 chars", () => {
    const ev = synthesizeCrashEvent("x".repeat(5000))
    expect(ev.output?.length).toBe(4096)
  })
})

describe("withinStartupGrace", () => {
  it("is false when startedAt is missing or unparseable", () => {
    expect(withinStartupGrace({})).toBe(false)
    expect(withinStartupGrace({ startedAt: "not-a-date" })).toBe(false)
  })

  it("is true just after start and false once the window elapses", () => {
    const justNow = new Date().toISOString()
    expect(withinStartupGrace({ startedAt: justNow })).toBe(true)
    const old = new Date(Date.now() - BACKGROUND_STARTUP_GRACE_MS - 1000).toISOString()
    expect(withinStartupGrace({ startedAt: old })).toBe(false)
  })
})

describe("hasObservableBackgroundProgress", () => {
  it("is true when a user-visible event is present", () => {
    expect(
      hasObservableBackgroundProgress({ events: [{ type: "token", text: "hi" }] })
    ).toBe(true)
    expect(
      hasObservableBackgroundProgress({ events: [{ type: "end" }] })
    ).toBe(true)
  })

  it("is true when raw output contains a non-JSON line", () => {
    expect(
      hasObservableBackgroundProgress({ events: [], rawOutput: "some stderr noise" })
    ).toBe(true)
  })

  it("is false for only-JSON raw output and no visible events", () => {
    expect(
      hasObservableBackgroundProgress({
        events: [{ type: "session", id: "s1" }],
        rawOutput: '{"type":"session","id":"s1"}',
      })
    ).toBe(false)
  })
})

describe("formatHistory", () => {
  it("renders a labelled conversation preamble", () => {
    const out = formatHistory([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ])
    expect(out).toContain("## Conversation History")
    expect(out).toContain("[User]: hello")
    expect(out).toContain("[Assistant]: hi")
  })
})

describe("meta-store: parseMeta", () => {
  it("parses a valid meta object", () => {
    const meta = parseMeta('{"currentTurn":2,"cursor":5,"provider":"claude"}')
    expect(meta).toMatchObject({ currentTurn: 2, cursor: 5, provider: "claude" })
  })

  it("returns null for empty, whitespace, invalid JSON, or missing fields", () => {
    expect(parseMeta("")).toBeNull()
    expect(parseMeta("   ")).toBeNull()
    expect(parseMeta(null)).toBeNull()
    expect(parseMeta("{not json")).toBeNull()
    expect(parseMeta('{"currentTurn":1}')).toBeNull() // cursor missing
  })
})

describe("meta-store: metaUnchanged", () => {
  const base: SessionMeta = {
    currentTurn: 1,
    cursor: 3,
    pid: 100,
    runId: "abc",
    outputFile: "/s/0.jsonl",
    provider: "claude",
    sessionId: "sess",
  }

  it("is true for field-for-field equal meta", () => {
    expect(metaUnchanged(base, { ...base })).toBe(true)
  })

  it("treats absent optional fields as their defaults", () => {
    expect(metaUnchanged({ ...base, sawEnd: undefined }, { ...base, sawEnd: false })).toBe(true)
    expect(metaUnchanged({ ...base, rawCursor: undefined }, { ...base, rawCursor: 0 })).toBe(true)
  })

  it("is false when any persisted field differs", () => {
    expect(metaUnchanged(base, { ...base, cursor: 4 })).toBe(false)
    expect(metaUnchanged(base, { ...base, sessionId: "other" })).toBe(false)
  })
})

describe("meta-store: readMeta / writeMeta round-trip", () => {
  it("readMeta parses what the sandbox returns, and null on empty", async () => {
    const meta: SessionMeta = { currentTurn: 0, cursor: 0, provider: "codex" }
    const okSandbox = {
      executeCommand: async () => ({ exitCode: 0, output: JSON.stringify(meta) }),
    } as unknown as CodeAgentSandbox
    expect(await readMeta(okSandbox, "/s")).toMatchObject(meta)

    const emptySandbox = {
      executeCommand: async () => ({ exitCode: 0, output: "" }),
    } as unknown as CodeAgentSandbox
    expect(await readMeta(emptySandbox, "/s")).toBeNull()
  })

  it("writeMeta base64-encodes the JSON into the write command", async () => {
    let captured = ""
    const sandbox = {
      executeCommand: async (cmd: string) => {
        captured = cmd
        return { exitCode: 0, output: "" }
      },
    } as unknown as CodeAgentSandbox

    const meta: SessionMeta = { currentTurn: 1, cursor: 2, provider: "claude" }
    await writeMeta(sandbox, "/sess", meta)

    // The command pipes a base64 blob into `base64 -d`; decoding it must
    // reproduce the exact JSON we asked to persist.
    const b64 = captured.match(/echo '([A-Za-z0-9+/=]+)' \| base64 -d/)?.[1]
    expect(b64).toBeTruthy()
    expect(Buffer.from(b64!, "base64").toString("utf8")).toBe(JSON.stringify(meta))
    expect(captured).toContain('/sess/meta.json')
  })
})
