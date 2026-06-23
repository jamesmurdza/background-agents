/**
 * Integration test against a real Daytona sandbox.
 *
 * One shared sandbox; short sleep-based commands; a hard in-harness deadline so
 * it can never hang. Proves the real contract: launch a long-running command,
 * reconnect repeatedly FROM COLD (a fresh handle rehydrated from JSON, and a
 * fresh `SandboxJobs` from a freshly-fetched sandbox) and read incrementally
 * with no duplicates and no gaps, attach by id alone, replay from zero, and
 * surface the true exit code. Plus: crash detection and cancel with name sweep.
 */
import "dotenv/config"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSandboxJobs, type JobHandle } from "../src/index.js"

const API_KEY = process.env.DAYTONA_API_KEY

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rehydrate = (h: JobHandle): JobHandle => JSON.parse(JSON.stringify(h))

describe.skipIf(!API_KEY)("sandbox-jobs (integration)", () => {
  const daytona = new Daytona({ apiKey: API_KEY! })
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await daytona.create()
  })

  afterAll(async () => {
    await sandbox?.delete().catch(() => {})
  })

  it("start() returns immediately even for a long-running job (no channel hang)", async () => {
    // Regression guard: the launch must detach so executeCommand returns at
    // once. If the backgrounded process keeps the read channel open, this call
    // blocks until the command finishes (here: ~120s) and Daytona raises a
    // "command execution timeout" long before that.
    const jobs = createSandboxJobs(sandbox)
    const t0 = Date.now()
    const handle = await jobs.start({ command: `sleep 120` })
    const elapsed = Date.now() - t0

    expect(elapsed).toBeLessThan(15_000) // launch is near-instant, not ~120s
    expect(handle.pid).toBeGreaterThan(0)

    // It really is running, then we reap it so the sandbox isn't left busy.
    expect((await jobs.status(handle)).state).toBe("running")
    await jobs.cancel(handle)
  })

  it("reconnects cold, reads incrementally, attaches by id, replays, and reports exit code", async () => {
    const TICKS = 6
    const handle = await createSandboxJobs(sandbox).start({
      command: `for i in $(seq 1 ${TICKS}); do echo "tick $i"; sleep 1; done`,
    })

    // Handle must survive a JSON round trip (the cold-reconnect contract).
    expect(rehydrate(handle)).toEqual(handle)

    // ── Cold incremental polling ────────────────────────────────────────────
    const lines: string[] = []
    const perRead: number[] = []
    let cursor = 0
    let exitCode: number | null = null
    let reconnects = 0
    const deadline = Date.now() + 45_000

    for (;;) {
      if (Date.now() > deadline) throw new Error("deadline exceeded — would have hung")
      await sleep(1000)

      // COLD START: fresh sandbox connection, fresh jobs client, rehydrated
      // handle. The only carried-over state is the integer cursor.
      const cold = await daytona.get(sandbox.id)
      const jobs = createSandboxJobs(cold)
      const r = await jobs.read(rehydrate(handle), cursor)

      reconnects++
      cursor = r.cursor
      perRead.push(r.bytesFetched)
      for (const l of r.raw.split("\n").filter(Boolean)) lines.push(l)

      if (r.status.state !== "running") {
        exitCode = r.status.exitCode
        break
      }
    }

    const expected = Array.from({ length: TICKS }, (_, i) => `tick ${i + 1}`)

    // Reconnected several times mid-run; stitched output is exact (no dup/gap).
    expect(reconnects).toBeGreaterThanOrEqual(2)
    expect(lines).toEqual(expected)
    expect(exitCode).toBe(0)

    // Incremental reads are bounded per-poll (not re-reading the whole log).
    // The largest single fetch is far smaller than the full transcript summed.
    const fullBytes = expected.join("\n").length
    expect(Math.max(...perRead)).toBeLessThan(fullBytes)

    // attach() from the id alone yields a working handle...
    const attached = await createSandboxJobs(await daytona.get(sandbox.id)).attach(
      handle.jobId,
      undefined
    )
    expect(attached).not.toBeNull()
    expect(attached!.pid).toBe(handle.pid)

    // ...and a replay-from-zero on it reproduces the full transcript + exit code.
    const replay = await createSandboxJobs(sandbox).read(attached!, 0)
    expect(replay.raw.split("\n").filter(Boolean)).toEqual(expected)
    expect(replay.status.exitCode).toBe(0)
  })

  it("reports a non-zero exit code", async () => {
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({ command: `echo boom; exit 3` })
    const deadline = Date.now() + 15_000
    for (;;) {
      if (Date.now() > deadline) throw new Error("deadline exceeded")
      const r = await jobs.read(handle)
      if (r.status.state !== "running") {
        expect(r.status.state).toBe("exited")
        expect(r.status.exitCode).toBe(3)
        break
      }
      await sleep(500)
    }
  })

  it("detects a crash (process killed before writing an exit code)", async () => {
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({
      command: `echo starting; sleep 60`,
    })
    await sleep(1500)
    // Hard-kill the leader WITHOUT writing an exit file (simulating SIGKILL/OOM).
    await sandbox.process.executeCommand(`kill -9 ${handle.pid} 2>/dev/null; true`)
    await sleep(1000)

    const r = await jobs.read(handle)
    expect(r.status.state).toBe("crashed")
    expect(r.status.exitCode).toBeNull()
    expect(r.raw).toContain("starting")
  })

  it("cancel() reaps escaped children via name-based sweep", async () => {
    // A daemonized child that calls setsid() re-sessions itself and would be
    // missed by a plain pid kill. The processName-based pkill sweep catches it.
    const pidFile = "/tmp/sbj-escapee.pid"
    await sandbox.process.executeCommand(`rm -f ${pidFile}; true`)
    // Embed a unique tag in the grandchild's command line so pkill -f matches.
    const TAG = "SBJ-ESC-CHECK"
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({
      command: `setsid sh -c 'sleep 300 #${TAG}' & echo $! > ${pidFile}; sleep 300`,
      processName: TAG,
    })
    await sleep(2500)

    const escapee = Number(
      ((await sandbox.process.executeCommand(`cat ${pidFile} 2>/dev/null`)).result ?? "").trim()
    )
    expect(escapee).toBeGreaterThan(0)
    // Before cancel, the escapee is alive.
    expect(
      (await sandbox.process.executeCommand(`kill -0 ${escapee} 2>/dev/null && echo ALIVE || echo DEAD`)).result?.trim()
    ).toBe("ALIVE")

    await jobs.cancel(handle)
    await sleep(1000)

    // After cancel, the name-based sweep killed it.
    const liveness = (
      await sandbox.process.executeCommand(
        `kill -0 ${escapee} 2>/dev/null && echo ALIVE || echo DEAD`
      )
    ).result?.trim()
    expect(liveness).toBe("DEAD")
  })

  it("cancel() terminates the job and reads back as terminal", async () => {
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({
      command: `for i in $(seq 1 100); do echo "n $i"; sleep 1; done`,
      processName: "sbj-seq",
    })
    await sleep(2500)
    await jobs.cancel(handle)
    await sleep(2000)

    // Process is truly dead.
    const stillAlive = (
      await sandbox.process.executeCommand(`kill -0 ${handle.pid} 2>/dev/null && echo ALIVE || echo DEAD`)
    ).result?.trim()
    expect(stillAlive).toBe("DEAD")

    const a = await jobs.read(handle)
    expect(a.status.state).not.toBe("running")
    // The TERM→wait→KILL sequence gives the process a brief window to
    // produce residual output, so we only assert it never reached tick 100.
    expect(a.raw.split("\n").filter(Boolean).length).toBeLessThan(100)
  })
})
