/**
 * Fast integration test for both background-runner strategies.
 *
 * The slow, hang-prone way to test this is one fresh sandbox per strategy plus
 * an unbounded poll loop. Instead we:
 *   - create ONE sandbox shared by every assertion (sandbox spin-up dominates
 *     wall-clock, so we pay it once),
 *   - launch and observe both strategies CONCURRENTLY (they use isolated files /
 *     sessions, so they never interfere),
 *   - bound the reconnect loop with a hard deadline so a stuck run fails fast
 *     instead of hanging.
 *
 * Each strategy still has to prove the real contract: launch a long-running
 * command, reconnect repeatedly from cold and read incrementally (no dup / no
 * gap), replay the whole log from zero on a fresh connection, and surface the
 * true exit code.
 *
 * Requires DAYTONA_API_KEY in the environment.
 */
import "dotenv/config"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { FileRunner } from "../src/file-runner.js"
import { SessionRunner } from "../src/session-runner.js"
import { observeByReconnecting } from "../src/harness.js"
import type { BackgroundRunner } from "../src/types.js"

const API_KEY = process.env.DAYTONA_API_KEY

// 6 ticks at 1s each ≈ 6s. Polling every 1s forces several cold reconnects
// while the command is still producing output — enough to prove incremental
// stitching without dragging the test out.
const TICKS = 6
const COMMAND = `for i in $(seq 1 ${TICKS}); do echo "tick $i"; sleep 1; done`
const EXPECTED = Array.from({ length: TICKS }, (_, i) => `tick ${i + 1}`)

const STRATEGIES: Array<{ label: string; make: (s: Sandbox) => BackgroundRunner }> = [
  { label: "FileRunner (Option C)", make: (s) => new FileRunner(s) },
  { label: "SessionRunner (Option A)", make: (s) => new SessionRunner(s) },
]

describe.skipIf(!API_KEY)("background runner strategies", () => {
  const daytona = new Daytona({ apiKey: API_KEY! })
  let sandbox: Sandbox

  beforeAll(async () => {
    sandbox = await daytona.create()
  })

  afterAll(async () => {
    await sandbox?.delete().catch(() => {})
  })

  it("both strategies reconnect, read incrementally, replay, and report exit code", async () => {
    // Run both strategies at once against the shared sandbox.
    await Promise.all(
      STRATEGIES.map(async ({ make }) => {
        const runner = make(sandbox)
        const handle = await runner.start(COMMAND)

        // The handle must be JSON-serializable (the cold-reconnect contract).
        expect(JSON.parse(JSON.stringify(handle))).toEqual(handle)

        const report = await observeByReconnecting({
          daytona,
          sandboxId: sandbox.id,
          makeRunner: make,
          handle,
          pollMs: 1000,
          deadlineMs: 45_000,
        })

        // Reconnected from cold multiple times while the command was running.
        expect(report.reconnects, runner.name).toBeGreaterThanOrEqual(2)

        // Incremental reads, stitched across reconnects, reproduce every line
        // exactly once and in order — no duplicates, no gaps.
        expect(report.lines, runner.name).toEqual(EXPECTED)

        // An independent replay-from-zero on a fresh connection agrees.
        expect(report.replayLines, runner.name).toEqual(EXPECTED)

        // Real exit code surfaced (not a heuristic).
        expect(report.exitCode, runner.name).toBe(0)
      })
    )
  })

  it("FileRunner stop() terminates the command and its children", async () => {
    const runner = new FileRunner(sandbox)
    const handle = await runner.start(`for i in $(seq 1 100); do echo "n $i"; sleep 1; done`)

    await new Promise((r) => setTimeout(r, 2500))
    await runner.stop(handle)
    await new Promise((r) => setTimeout(r, 1500))

    // After stop the command is dead, so output stops advancing and it never
    // reaches its 100th tick.
    const a = await runner.readAll(handle)
    await new Promise((r) => setTimeout(r, 2000))
    const b = await runner.readAll(handle)
    expect(b.lines.length).toBe(a.lines.length)
    expect(a.lines.length).toBeLessThan(100)
  })
})
