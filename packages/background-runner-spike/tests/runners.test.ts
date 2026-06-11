/**
 * Integration tests for both background-runner strategies.
 *
 * Each test creates its OWN fresh sandbox (and deletes it afterward), then
 * proves the strategy can:
 *   - launch a long-running command,
 *   - reconnect repeatedly from cold and read incrementally (no dup/no gap),
 *   - replay the full log from zero on yet another cold connection,
 *   - report the real exit code.
 *
 * Requires DAYTONA_API_KEY in the environment.
 */
import "dotenv/config"
import { afterEach, describe, expect, it } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { FileRunner } from "../src/file-runner.js"
import { SessionRunner } from "../src/session-runner.js"
import { observeByReconnecting } from "../src/harness.js"
import type { BackgroundRunner } from "../src/types.js"

const API_KEY = process.env.DAYTONA_API_KEY

// ~8 ticks at 1s each ≈ 8s. Polling every 1.2s forces several cold reconnects
// while the command is still producing output.
const TICKS = 8
const COMMAND = `for i in $(seq 1 ${TICKS}); do echo "tick $i"; sleep 1; done`
const EXPECTED = Array.from({ length: TICKS }, (_, i) => `tick ${i + 1}`)

const STRATEGIES: Array<{ label: string; make: (s: Sandbox) => BackgroundRunner }> = [
  { label: "FileRunner (Option C)", make: (s) => new FileRunner(s) },
  { label: "SessionRunner (Option A)", make: (s) => new SessionRunner(s) },
]

describe.skipIf(!API_KEY)("background runner strategies", () => {
  let sandbox: Sandbox | undefined

  afterEach(async () => {
    if (sandbox) {
      await sandbox.delete().catch(() => {})
      sandbox = undefined
    }
  })

  for (const { label, make } of STRATEGIES) {
    it(`${label}: reconnects, reads incrementally, replays, and reports exit code`, async () => {
      const daytona = new Daytona({ apiKey: API_KEY! })
      sandbox = await daytona.create()

      const runner = make(sandbox)
      const handle = await runner.start(COMMAND)

      // The handle must be JSON-serializable (the cold-reconnect contract).
      expect(JSON.parse(JSON.stringify(handle))).toEqual(handle)

      const report = await observeByReconnecting({
        daytona,
        sandboxId: sandbox.id,
        makeRunner: make,
        handle,
        pollMs: 1200,
      })

      // Reconnected from cold multiple times while the command was running.
      expect(report.reconnects).toBeGreaterThanOrEqual(2)

      // Incremental reads, stitched across reconnects, reproduce every line
      // exactly once and in order — no duplicates, no gaps.
      expect(report.lines).toEqual(EXPECTED)

      // An independent replay-from-zero on a fresh connection agrees.
      expect(report.replayLines).toEqual(EXPECTED)

      // Real exit code surfaced (not a heuristic).
      expect(report.exitCode).toBe(0)
    })
  }

  it.skipIf(!API_KEY)("FileRunner stop() terminates the command", async () => {
    const daytona = new Daytona({ apiKey: API_KEY! })
    sandbox = await daytona.create()

    const runner = new FileRunner(sandbox)
    const handle = await runner.start(`for i in $(seq 1 100); do echo "n $i"; sleep 1; done`)
    await new Promise((r) => setTimeout(r, 2500))
    await runner.stop(handle)
    await new Promise((r) => setTimeout(r, 1500))

    // After stop, the command is finished (no longer producing) — a follow-up
    // read should report it as done or simply stop advancing.
    const a = await runner.readAll(handle)
    await new Promise((r) => setTimeout(r, 2000))
    const b = await runner.readAll(handle)
    expect(b.lines.length).toBe(a.lines.length)
    expect(a.lines.length).toBeLessThan(100)
  })
})
