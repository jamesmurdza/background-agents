/**
 * Integration test against a real Daytona sandbox.
 *
 * One shared sandbox; short sleep-based commands; a hard in-harness deadline so
 * it can never hang. Proves the real contract: launch a long-running command,
 * reconnect repeatedly FROM COLD (a fresh handle rehydrated from JSON, and a
 * fresh `SandboxJobs` from a freshly-fetched sandbox) and read incrementally
 * with no duplicates and no gaps, attach by id alone, replay from zero, and
 * surface the true exit code. Plus: crash detection and cancel.
 *
 * Requires DAYTONA_API_KEY in the environment.
 */
import "dotenv/config"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSandboxJobs, type JobHandle } from "../src/index.js"

const API_KEY = process.env.DAYTONA_API_KEY

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function pollUntil<T>(read: () => Promise<T>, expected: T, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let actual: T
  do {
    actual = await read()
    if (actual === expected) return
    await sleep(200)
  } while (Date.now() < deadline)
  expect(actual).toBe(expected)
}
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
    expect(handle.pgid).toBeGreaterThan(0)

    // It really is running, then we reap it so the sandbox isn't left busy.
    expect((await jobs.status(handle)).state).toBe("running")
    await jobs.cancel(handle)
  })

  it("gives the job its env without putting any value in the command or its command line", async () => {
    const secret = `env-field-${Date.now()}`
    const sent: string[] = []
    const executeCommand = sandbox.process.executeCommand.bind(sandbox.process)
    const recording = { process: { executeCommand: (...args: Parameters<typeof executeCommand>) => {
      sent.push(args[0])
      return executeCommand(...args)
    } } } as unknown as Sandbox
    const jobs = createSandboxJobs(recording)
    const handle = await jobs.start({ command: `printf '%s\\n' "$PROOF_KEY"; sleep 30`, env: { PROOF_KEY: secret } })
    try {
      await pollUntil(async () => (await jobs.read(handle, 0)).raw.trim(), secret, 15_000)
      expect(sent.some((command) => command.includes(secret))).toBe(false)
      // Nothing running in the sandbox shows the value in its arguments.
      const ps = await sandbox.process.executeCommand("ps -eo args")
      expect(ps.result).not.toContain(secret)
    } finally {
      await jobs.cancel(handle)
    }
  })

  it("reports the real reason when the launch command is too long", async () => {
    // A single shell argument is limited to 128 KiB on Linux. Before, this
    // showed only "Sandbox job operation could not be confirmed".
    await expect(createSandboxJobs(sandbox).start({ command: `echo ${"A".repeat(200_000)}` }))
      .rejects.toThrow(/Could not start sandbox job \(exit code \d+\): .*Argument list too long/)
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
    expect(attached!.pgid).toBe(handle.pgid)

    // ...and a replay-from-zero on it reproduces the full transcript + exit code.
    const replay = await createSandboxJobs(sandbox).read(attached!, 0)
    expect(replay.raw.split("\n").filter(Boolean)).toEqual(expected)
    expect(replay.status.exitCode).toBe(0)
  })

  it.each([false, true])("completes a command while its HTTP service stays available (detached=%s)", async (detached) => {
    const jobs = createSandboxJobs(sandbox)
    const port = detached ? 18768 : 18767
    const handle = await jobs.start({
      command: `${detached ? "setsid " : ""}python3 -m http.server ${port} >/tmp/preview-${port}.log 2>&1 & echo service-started`,
    })
    try {
      await pollUntil(async () => (await sandbox.process.executeCommand(
        `curl -fsS http://127.0.0.1:${port}/ >/dev/null && echo reachable`
      )).result?.trim(), "reachable", 15_000)
      // Rehydrate through the real filesystem, as a different web worker does.
      const cold = createSandboxJobs(await daytona.get(sandbox.id))
      const attached = await cold.attach(handle.jobId)
      expect(attached).not.toBeNull()
      await pollUntil(async () => (await cold.status(attached!)).state, "exited", 5_000)
      const read = await cold.read(attached!, 0)
      expect(read.status).toEqual({ state: "exited", alive: false, exitCode: 0 })
      expect(read.raw).toContain("service-started")
      // A later job and its cancellation must not stop the completed job's server.
      const next = await jobs.start({ command: "echo next-started; sleep 30" })
      try {
        expect((await jobs.status(next)).alive).toBe(true)
        await jobs.cancel(next)
        expect((await jobs.status(next)).alive).toBe(false)
        const http = await sandbox.process.executeCommand(`curl -fsS http://127.0.0.1:${port}/ >/dev/null && echo reachable`)
        expect(http.result?.trim()).toBe("reachable")
      } finally {
        await jobs.cancel(next)
      }
    } finally {
      // Explicit cleanup still owns every service, including setsid escapees.
      await jobs.cancel(handle)
    }
  })

  it("keeps an uncertain execution owned after an early exit signal and wrapper crash", async () => {
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({ command: "setsid sleep 60 >/dev/null 2>&1 & echo started; sleep 60" })
    try {
      await sandbox.process.executeCommand(`echo 0 > '${handle.exitFile}'`)
      expect((await jobs.status(handle)).alive).toBe(true)
      await sandbox.process.executeCommand(`kill -KILL ${handle.pgid}`)
      expect((await jobs.status(handle)).alive).toBe(true)
      // An untrusted exit file does not prove the foreground command completed.
      expect((await jobs.read(handle)).status.state).toBe("running")
    } finally {
      await jobs.cancel(handle)
    }
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
      command: `echo starting; sleep 30`,
    })
    await sleep(1500)
    // Hard-kill the whole group WITHOUT writing an exit file (simulating
    // SIGKILL/OOM): cancel() would write a sentinel, so we kill directly.
    await sandbox.process.executeCommand(`kill -KILL -- -${handle.pgid} 2>/dev/null; true`)
    await sleep(1000)

    const r = await jobs.read(handle)
    expect(r.status.state).toBe("crashed")
    expect(r.status.exitCode).toBeNull()
    expect(r.raw).toContain("starting")
  })

  it("cancel() reaps a child that escaped the process group via setsid (cgroup)", async () => {
    // Regression guard for the RAM leak: an MCP-server-like child that calls
    // setsid() lands in its OWN process group, so a process-group kill misses
    // it. cgroup membership is inherited through setsid, so cancel()'s
    // cgroup.kill must still reap it. Requires cgroup-v2 + sudo in the image.
    const jobs = createSandboxJobs(sandbox)
    const pidFile = "/tmp/sbj-escapee.pid"
    await sandbox.process.executeCommand(`rm -f ${pidFile}; true`)
    // Spawn a detached grandchild (own session/group), record its pid, then the
    // leader itself blocks so the job stays running until we cancel it.
    const handle = await jobs.start({
      command: `setsid sleep 300 & echo $! > ${pidFile}; sleep 300`,
    })
    await sleep(2500)

    const escapee = Number(
      ((await sandbox.process.executeCommand(`cat ${pidFile} 2>/dev/null`)).result ?? "").trim()
    )
    expect(escapee).toBeGreaterThan(0)
    // It escaped: its process group differs from the job's leader group.
    const pgidOut = (
      await sandbox.process.executeCommand(`ps -o pgid= -p ${escapee} | tr -d ' \n'`)
    ).result?.trim()
    expect(Number(pgidOut)).not.toBe(handle.pgid)

    await jobs.cancel(handle)
    await sleep(1000)

    const liveness = (
      await sandbox.process.executeCommand(
        `kill -0 ${escapee} 2>/dev/null && echo ALIVE || echo DEAD`
      )
    ).result?.trim()
    expect(liveness).toBe("DEAD")
  })

  it("cancel() terminates the job and its children and reads back as terminal", async () => {
    const jobs = createSandboxJobs(sandbox)
    const handle = await jobs.start({
      command: `for i in $(seq 1 100); do echo "n $i"; sleep 1; done`,
    })
    await sleep(2500)
    await jobs.cancel(handle)
    await sleep(1000)

    const a = await jobs.read(handle)
    expect(a.status.state).not.toBe("running") // terminal after cancel
    await sleep(1500)
    const b = await jobs.read(handle, a.cursor)
    // No further output after cancellation, and it never reached tick 100.
    expect(b.raw).toBe("")
    expect(a.raw.split("\n").filter(Boolean).length).toBeLessThan(100)
  })
})
