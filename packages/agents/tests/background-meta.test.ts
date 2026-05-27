/**
 * Tests for session meta.json robustness helpers and readMeta retry behavior.
 */
import { describe, it, expect, vi } from "vitest"
import {
  META_ABSENT_SENTINEL,
  parseSessionMeta,
  buildReadMetaCommand,
  buildAtomicWriteMetaCommand,
} from "../src/background/meta.js"
import { createBackgroundSession } from "../src/background/session.js"
import type { SessionMeta } from "../src/background/types.js"
import type { AgentDefinition } from "../src/core/agent.js"
import type { CodeAgentSandbox } from "../src/types/provider.js"

const validMeta: SessionMeta = {
  currentTurn: 2,
  cursor: 5,
  runId: "abc123",
  outputFile: "/tmp/codeagent-x/2.jsonl",
  pid: 4321,
  startedAt: "2026-05-27T00:00:00.000Z",
  provider: "claude",
  sessionId: "sess-1",
}

describe("parseSessionMeta", () => {
  it("parses a valid meta object", () => {
    expect(parseSessionMeta(JSON.stringify(validMeta))).toEqual(validMeta)
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseSessionMeta(`\n  ${JSON.stringify(validMeta)}  \n`)).toEqual(validMeta)
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace only", "   \n\t "],
    ["empty-object placeholder", "{}"],
    ["absent sentinel", META_ABSENT_SENTINEL],
    ["malformed JSON (partial write)", '{"currentTurn":2,"cur'],
    ["non-JSON garbage", "not json at all"],
  ])("returns null for %s", (_label, input) => {
    expect(parseSessionMeta(input as string | null | undefined)).toBeNull()
  })

  it("returns null when required numeric fields are missing", () => {
    expect(parseSessionMeta('{"cursor":5}')).toBeNull() // no currentTurn
    expect(parseSessionMeta('{"currentTurn":2}')).toBeNull() // no cursor
    expect(parseSessionMeta('{"currentTurn":"2","cursor":5}')).toBeNull() // wrong type
  })

  it("accepts a minimal valid meta (just the required fields)", () => {
    expect(parseSessionMeta('{"currentTurn":0,"cursor":0}')).toEqual({
      currentTurn: 0,
      cursor: 0,
    })
  })
})

describe("buildReadMetaCommand", () => {
  it("reads the meta.json under the session dir", () => {
    const cmd = buildReadMetaCommand("/tmp/codeagent-x")
    expect(cmd).toContain('/tmp/codeagent-x/meta.json')
    expect(cmd).toContain("cat ")
  })

  it("emits the absent sentinel when the file does not exist (not a swallowed error)", () => {
    const cmd = buildReadMetaCommand("/tmp/codeagent-x")
    expect(cmd).toContain("if [ -f")
    expect(cmd).toContain(META_ABSENT_SENTINEL)
    // Must NOT swallow errors the way the old `2>/dev/null || true` did.
    expect(cmd).not.toContain("|| true")
  })
})

describe("buildAtomicWriteMetaCommand", () => {
  it("writes to a temp file then atomically moves it into place", () => {
    const cmd = buildAtomicWriteMetaCommand("/tmp/codeagent-x", validMeta)
    expect(cmd).toContain('mkdir -p "/tmp/codeagent-x"')
    expect(cmd).toMatch(/> "\/tmp\/codeagent-x\/\.meta\.[^"]+\.tmp"/) // temp target
    expect(cmd).toContain('mv -f') // atomic rename
    expect(cmd).toContain('"/tmp/codeagent-x/meta.json"') // final destination
    // The mv must come after the write (so a failed write leaves meta.json intact).
    expect(cmd.indexOf("base64 -d >")).toBeLessThan(cmd.indexOf("mv -f"))
  })

  it("base64-encodes the exact meta payload (round-trips)", () => {
    const cmd = buildAtomicWriteMetaCommand("/tmp/codeagent-x", validMeta)
    const match = cmd.match(/echo '([^']+)' \| base64 -d/)
    expect(match).not.toBeNull()
    const decoded = Buffer.from(match![1], "base64").toString("utf8")
    expect(JSON.parse(decoded)).toEqual(validMeta)
  })

  it("uses distinct temp names for distinct cursors (avoids writer collisions)", () => {
    const a = buildAtomicWriteMetaCommand("/d", { ...validMeta, cursor: 1 })
    const b = buildAtomicWriteMetaCommand("/d", { ...validMeta, cursor: 2 })
    const tempA = a.match(/\.meta\.[^"]+\.tmp/)![0]
    const tempB = b.match(/\.meta\.[^"]+\.tmp/)![0]
    expect(tempA).not.toEqual(tempB)
  })
})

describe("BackgroundSession.readMeta retry behavior", () => {
  const fakeAgent = { name: "test" } as unknown as AgentDefinition

  function makeSandbox(outputs: string[]): {
    sandbox: CodeAgentSandbox
    calls: string[]
  } {
    const calls: string[] = []
    let i = 0
    const sandbox = {
      ensureProvider: vi.fn(),
      setEnvVars: vi.fn(),
      executeCommand: vi.fn().mockImplementation(async (command: string) => {
        calls.push(command)
        const output = outputs[Math.min(i, outputs.length - 1)]
        i += 1
        return { exitCode: 0, output }
      }),
    } as unknown as CodeAgentSandbox
    return { sandbox, calls }
  }

  // readMeta is private; call it directly to test the retry loop in isolation.
  const readMeta = (s: ReturnType<typeof createBackgroundSession>, retries?: number) =>
    (s as unknown as { readMeta(r?: number): Promise<SessionMeta | null> }).readMeta(retries)

  it("recovers when a transient empty read is followed by a valid one", async () => {
    const { sandbox, calls } = makeSandbox(["", "", JSON.stringify(validMeta)])
    const session = createBackgroundSession(fakeAgent, sandbox, "/tmp/codeagent-x")
    const meta = await readMeta(session)
    expect(meta).toEqual(validMeta)
    expect(calls).toHaveLength(3) // retried twice before succeeding
  })

  it("does NOT retry when the file is genuinely absent", async () => {
    const { sandbox, calls } = makeSandbox([META_ABSENT_SENTINEL])
    const session = createBackgroundSession(fakeAgent, sandbox, "/tmp/codeagent-x")
    const meta = await readMeta(session)
    expect(meta).toBeNull()
    expect(calls).toHaveLength(1) // absent → immediate, no wasted retries
  })

  it("gives up after the retry budget when reads stay unreadable", async () => {
    const { sandbox, calls } = makeSandbox([""]) // always empty
    const session = createBackgroundSession(fakeAgent, sandbox, "/tmp/codeagent-x")
    const meta = await readMeta(session, 2)
    expect(meta).toBeNull()
    expect(calls).toHaveLength(3) // initial + 2 retries
  })
})
