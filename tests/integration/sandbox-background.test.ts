/**
 * Real sandbox integration tests: create a Daytona sandbox, run background session flow,
 * then delete the sandbox. Skip when DAYTONA_API_KEY or ANTHROPIC_API_KEY are unset.
 *
 * Run with network allowed (e.g. CI or local):
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm run test -- tests/integration/sandbox-background.test.ts
 */
import "dotenv/config"
import { describe, it, expect } from "vitest"
import { Daytona } from "@daytonaio/sdk"
import { createBackgroundSession } from "../../src/index.js"

const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY

describe.skipIf(!hasSandboxKeys)("real sandbox background (Daytona + Claude)", () => {
  it("start returns quickly; isRunning true then false; getEvents returns end; getPid null after; sandbox deleted", async () => {
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
    const sandbox = await daytona.create({
      envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    })

    try {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const t0 = Date.now()
      const startResult = await bg.start(
        "List the numbers 1 to 5, one per line, then say DONE."
      )
      const startMs = Date.now() - t0

      expect(startResult.pid).toBeGreaterThan(0)
      expect(startResult.outputFile).toBeDefined()
      expect(startMs).toBeLessThan(30_000)

      const pidFromGetPid = await bg.getPid()
      expect(pidFromGetPid).toBe(startResult.pid)

      const runningRightAfter = await bg.isRunning()
      expect(runningRightAfter).toBe(true)

      const timeoutMs = 90_000
      const pollIntervalMs = 2000
      const deadline = Date.now() + timeoutMs
      let events: Awaited<ReturnType<typeof bg.getEvents>>["events"] = []

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs))
        const res = await bg.getEvents()
        events = res.events
        const hasEnd = events.some((e) => e.type === "end")
        if (hasEnd) break
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.type === "end")).toBe(true)

      const pidAfterEnd = await bg.getPid()
      expect(pidAfterEnd).toBeNull()

      const runningAfter = await bg.isRunning()
      expect(runningAfter).toBe(false)
    } finally {
      await sandbox.delete()
    }
  }, 100_000)

  it("cancel() kills running background session (kill over SSH)", async () => {
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
    const sandbox = await daytona.create({
      envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    })

    try {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(
        "Run this in the shell and wait for it to finish: sleep 20 && echo DONE."
      )
      expect(await bg.isRunning()).toBe(true)

      await new Promise((r) => setTimeout(r, 4000))
      expect(await bg.isRunning()).toBe(true)

      await bg.cancel()

      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const running = await bg.isRunning()
        if (!running) break
        await new Promise((r) => setTimeout(r, 500))
      }
      expect(await bg.isRunning()).toBe(false)
    } finally {
      await sandbox.delete()
    }
  }, 60_000)
})
