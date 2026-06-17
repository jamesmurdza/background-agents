/**
 * Fast end-to-end test of the background turn-manager over the real
 * @background-agents/sandbox-jobs primitive — WITHOUT any real agent CLI.
 *
 * A synthetic AgentDefinition emits agent-style JSONL via `printf`/`sleep`, so
 * the whole path (createBackgroundSession → start → incremental poll → cumulative
 * events → end + exit code → cold reattach) is exercised against a real Daytona
 * sandbox in seconds, not minutes.
 *
 * One shared sandbox; a hard deadline so it can never hang.
 * Requires DAYTONA_API_KEY.
 */
import "dotenv/config"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import type { AgentDefinition } from "../../src/core/agent"
import type { Event } from "../../src/types/events"
import { adaptDaytonaSandbox } from "../../src/sandbox/daytona"
import {
  createBackgroundSession,
  writeInitialSessionMeta,
  readProviderFromMeta,
} from "../../src/background/session"

const API_KEY = process.env.DAYTONA_API_KEY
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A synthetic agent: it emits a session id, three tokens (1s apart), then end.
const TICKS = 3
const fakeAgent: AgentDefinition = {
  name: "fake",
  toolMappings: {},
  capabilities: { supportsSystemPrompt: true },
  buildCommand() {
    // Emit one JSON object per line, flushing as it goes.
    const lines = [
      `{"type":"session","id":"sess-xyz"}`,
      ...Array.from({ length: TICKS }, (_, i) => `{"type":"token","text":"t${i + 1}"}`),
    ]
    const script = lines
      .map((l, i) => (i === 0 ? `printf '%s\\n' '${l}'` : `sleep 1; printf '%s\\n' '${l}'`))
      .join("; ")
    return { cmd: "sh", args: ["-c", `${script}; sleep 1; printf '%s\\n' '{"type":"end"}'`] }
  },
  parse(line) {
    try {
      const o = JSON.parse(line) as { type: string; id?: string; text?: string }
      if (o.type === "session") return { type: "session", id: o.id! } as Event
      if (o.type === "token") return { type: "token", text: o.text ?? "" } as Event
      if (o.type === "end") return { type: "end" } as Event
      return null
    } catch {
      return null
    }
  },
}

// A synthetic agent that exits non-zero WITHOUT emitting `end` → a crash.
const crashAgent: AgentDefinition = {
  name: "crashy",
  toolMappings: {},
  buildCommand() {
    return { cmd: "sh", args: ["-c", `echo "boom: auth failed" 1>&2; exit 7`] }
  },
  parse() {
    return null
  },
}

describe.skipIf(!API_KEY)("background turn-manager (fast e2e)", () => {
  const daytona = new Daytona({ apiKey: API_KEY! })
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await daytona.create()
  })

  afterAll(async () => {
    await sandbox?.delete().catch(() => {})
  })

  it("runs a turn, polls incrementally, reattaches cold, and completes", async () => {
    const sessionDir = "/tmp/codeagent-fast-1"
    const adapted = adaptDaytonaSandbox(sandbox)
    await writeInitialSessionMeta(adapted, sessionDir, fakeAgent.name, null)

    const session = createBackgroundSession(fakeAgent, adapted, sessionDir)
    const handle = await session.start("hi")
    expect(handle.pid).toBeGreaterThan(0)
    expect(handle.outputFile).toContain(sessionDir)

    // ── Cold incremental polling: a fresh session object each tick, rebuilt
    // from the sandbox (simulating a serverless cold start). getEvents()
    // returns deltas; we stitch them.
    let running = true
    let lastPoll: Awaited<ReturnType<typeof session.poll>> | null = null
    const deadline = Date.now() + 30_000
    let polls = 0

    while (running) {
      if (Date.now() > deadline) throw new Error("deadline exceeded — would have hung")
      await sleep(1000)
      const cold = createBackgroundSession(
        fakeAgent,
        adaptDaytonaSandbox(await daytona.get(sandbox.id)),
        sessionDir
      )
      // poll() = cumulative (what the web uses); also exercise reattach.
      lastPoll = await cold.poll()
      polls++
      // Deltas via a second fresh object using getEvents would advance its own
      // cursor; here we assert via the cumulative poll instead.
      running = lastPoll.running
    }

    expect(polls).toBeGreaterThanOrEqual(2)
    expect(lastPoll).not.toBeNull()
    // Cumulative events include the session, all tokens, and the end.
    const types = lastPoll!.events.map((e) => e.type)
    expect(types).toContain("session")
    expect(types.filter((t) => t === "token").length).toBe(TICKS)
    expect(types).toContain("end")
    expect(lastPoll!.sessionId).toBe("sess-xyz")
    expect(lastPoll!.runPhase).toBe("stopped")

    // The captured agent session id was persisted to meta for resume/reattach.
    const meta = await readProviderFromMeta(adapted, sessionDir)
    expect(meta?.provider).toBe("fake")
    expect(meta?.sessionId).toBe("sess-xyz")

    // A from-zero snapshot on a fresh cold object reproduces the same set.
    const snap = await createBackgroundSession(
      fakeAgent,
      adaptDaytonaSandbox(await daytona.get(sandbox.id)),
      sessionDir
    ).getSnapshot()
    expect(snap.events.map((e) => e.type)).toEqual(types)
    expect(snap.running).toBe(false)
  }, 60_000)

  it("getEvents() returns deltas that stitch into the full cumulative set", async () => {
    const sessionDir = "/tmp/codeagent-fast-delta"
    const adapted = adaptDaytonaSandbox(sandbox)
    await writeInitialSessionMeta(adapted, sessionDir, fakeAgent.name, null)

    // Single warm session object so getEvents() deltas advance one cursor.
    const session = createBackgroundSession(fakeAgent, adapted, sessionDir)
    await session.start("hi")

    const stitched: Event[] = []
    const deadline = Date.now() + 30_000
    for (;;) {
      if (Date.now() > deadline) throw new Error("deadline exceeded")
      await sleep(800)
      const r = await session.getEvents()
      stitched.push(...r.events) // deltas — no duplicates expected
      if (!r.running) break
    }

    // Each event appears exactly once across the stitched deltas.
    expect(stitched.filter((e) => e.type === "token").length).toBe(TICKS)
    expect(stitched.filter((e) => e.type === "session").length).toBe(1)
    expect(stitched.filter((e) => e.type === "end").length).toBe(1)
  }, 60_000)

  it("detects a real crash and surfaces the stderr tail", async () => {
    const sessionDir = "/tmp/codeagent-fast-crash"
    const adapted = adaptDaytonaSandbox(sandbox)
    await writeInitialSessionMeta(adapted, sessionDir, crashAgent.name, null)

    const session = createBackgroundSession(crashAgent, adapted, sessionDir)
    await session.start("hi")

    const deadline = Date.now() + 15_000
    let snap = await session.getSnapshot()
    while (snap.running) {
      if (Date.now() > deadline) throw new Error("deadline exceeded")
      await sleep(700)
      snap = await session.getSnapshot()
    }

    const crash = snap.events.find((e) => e.type === "agent_crashed") as
      | { type: "agent_crashed"; message?: string; output?: string }
      | undefined
    expect(crash).toBeDefined()
    expect(crash!.output ?? "").toContain("boom: auth failed")
    expect(snap.runPhase).toBe("stopped")
  }, 60_000)

  it("cancel() stops a long turn and it does not read back as a crash", async () => {
    const sessionDir = "/tmp/codeagent-fast-cancel"
    const adapted = adaptDaytonaSandbox(sandbox)
    await writeInitialSessionMeta(adapted, sessionDir, fakeAgent.name, null)

    const longAgent: AgentDefinition = {
      ...fakeAgent,
      name: "longy",
      buildCommand() {
        return {
          cmd: "sh",
          args: ["-c", `printf '%s\\n' '{"type":"token","text":"go"}'; sleep 60`],
        }
      },
    }

    const session = createBackgroundSession(longAgent, adapted, sessionDir)
    await session.start("hi")
    await sleep(2000)
    await session.cancel()
    await sleep(1000)

    const snap = await session.getSnapshot()
    expect(snap.running).toBe(false)
    // Cancellation must NOT manifest as a crash event.
    expect(snap.events.some((e) => e.type === "agent_crashed")).toBe(false)
  }, 60_000)
})
