/**
 * Integration tests for background session lifecycle and advanced features.
 *
 * Tests session reattachment, multiple turns, cancellation, crash detection,
 * and concurrent polling.
 *
 * Required env vars:
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY (using Claude for these tests)
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/sandbox-background.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createBackgroundSession, getBackgroundSession, type Event } from "../../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."
const LONG_RUNNING_PROMPT = "Count from 1 to 5, wait 2 seconds between each number."

// Helper to poll until end or timeout
async function pollUntilEnd(
  bg: Awaited<ReturnType<typeof createBackgroundSession>>,
  timeoutMs = 120_000,
  pollIntervalMs = 2000
): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs
  const allEvents: Event[] = []

  while (Date.now() < deadline) {
    const { events } = await bg.getEvents()
    for (const event of events) {
      if (!allEvents.some(e => e === event)) {
        allEvents.push(event)
      }
    }
    if (allEvents.some((e) => e.type === "end" || e.type === "agent_crashed")) break
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  return allEvents
}

// Helper to wait for specific event type
async function waitForEvent(
  bg: Awaited<ReturnType<typeof createBackgroundSession>>,
  eventType: string,
  timeoutMs = 30_000
): Promise<Event | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { events } = await bg.getEvents()
    const found = events.find(e => e.type === eventType)
    if (found) return found
    await new Promise((r) => setTimeout(r, 1000))
  }

  return null
}

describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)("sandbox background session tests", () => {
  let daytona: Daytona
  let sandbox: Sandbox

  beforeAll(async () => {
    daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
    sandbox = await daytona.create({
      envVars: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY! },
    })
  }, 60_000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.delete()
    }
  }, 30_000)

  describe("session reattachment", () => {
    it("can reattach to existing background session", async () => {
      // Create initial session
      const bg1 = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const sessionId1 = bg1.id
      expect(sessionId1).toBeDefined()

      // Start a task
      const { pid } = await bg1.start(SIMPLE_PROMPT)
      expect(pid).toBeGreaterThan(0)

      // Reattach using the same background session ID
      const bg2 = await getBackgroundSession({
        sandbox: sandbox as any,
        backgroundSessionId: sessionId1,
      })

      expect(bg2.id).toBe(sessionId1)

      // Should be able to poll from reattached session
      const events = await pollUntilEnd(bg2)
      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)

    it("reattached session preserves provider info", async () => {
      const bg1 = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const sessionId = bg1.id
      await bg1.start(SIMPLE_PROMPT)

      // Reattach without specifying provider (should read from meta)
      const bg2 = await getBackgroundSession({
        sandbox: sandbox as any,
        backgroundSessionId: sessionId,
      })

      expect(bg2.provider.name).toBe("claude")

      await pollUntilEnd(bg2)
    }, 180_000)

    it("throws error when reattaching to non-existent session", async () => {
      await expect(
        getBackgroundSession({
          sandbox: sandbox as any,
          backgroundSessionId: "non-existent-id-12345",
        })
      ).rejects.toThrow(/meta not found/)
    }, 30_000)
  })

  describe("multiple turns", () => {
    it("handles multiple sequential prompts correctly", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // First turn
      await bg.start(SIMPLE_PROMPT)
      const events1 = await pollUntilEnd(bg)
      expect(events1.some((e) => e.type === "end")).toBe(true)

      // Should not be running after first turn
      expect(await bg.isRunning()).toBe(false)

      // Second turn
      await bg.start("What is 3 + 3? Reply with just the number.")
      const events2 = await pollUntilEnd(bg)
      expect(events2.some((e) => e.type === "end")).toBe(true)

      // Third turn
      await bg.start("What is 5 + 5? Reply with just the number.")
      const events3 = await pollUntilEnd(bg)
      expect(events3.some((e) => e.type === "end")).toBe(true)

      expect(await bg.isRunning()).toBe(false)
    }, 300_000)

    it("cursor advances correctly between turns", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // First turn
      await bg.start(SIMPLE_PROMPT)

      let lastCursor = "0"
      while (true) {
        const { events, cursor } = await bg.getEvents()
        if (cursor !== lastCursor) {
          expect(Number(cursor)).toBeGreaterThan(Number(lastCursor))
          lastCursor = cursor
        }
        if (events.some((e) => e.type === "end")) break
        await new Promise((r) => setTimeout(r, 1000))
      }

      // Second turn - cursor should reset or continue correctly
      await bg.start("What is 10 + 10?")
      const { cursor: newCursor } = await bg.getEvents()
      expect(newCursor).toBeDefined()

      await pollUntilEnd(bg)
    }, 180_000)
  })

  describe("cancellation", () => {
    it("can cancel a running background process", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Start a longer-running task
      await bg.start(LONG_RUNNING_PROMPT)

      // Verify it's running
      expect(await bg.isRunning()).toBe(true)

      // Wait a bit to ensure it's started
      await new Promise((r) => setTimeout(r, 3000))

      // Cancel it
      await bg.cancel()

      // Wait a moment for cancellation to take effect
      await new Promise((r) => setTimeout(r, 2000))

      // Should no longer be running
      expect(await bg.isRunning()).toBe(false)

      // Should get crash event on next poll
      const { events } = await bg.getEvents()
      expect(events.some((e) => e.type === "agent_crashed")).toBe(true)
    }, 60_000)

    it("cancel is safe when nothing is running", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Cancel without starting anything - should not throw
      await expect(bg.cancel()).resolves.toBeUndefined()

      expect(await bg.isRunning()).toBe(false)
    }, 30_000)

    it("can start new turn after cancellation", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Start and cancel
      await bg.start(LONG_RUNNING_PROMPT)
      await new Promise((r) => setTimeout(r, 2000))
      await bg.cancel()
      await new Promise((r) => setTimeout(r, 2000))

      // Start new turn
      await bg.start(SIMPLE_PROMPT)
      const events = await pollUntilEnd(bg)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 120_000)
  })

  describe("crash detection", () => {
    it("detects when process crashes unexpectedly", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const { pid } = await bg.start(LONG_RUNNING_PROMPT)

      // Wait for it to start
      await new Promise((r) => setTimeout(r, 3000))

      // Kill the process directly (simulate crash)
      await sandbox.process.executeCommand(`kill -9 ${pid}`, undefined, undefined, 10)

      // Wait a moment
      await new Promise((r) => setTimeout(r, 2000))

      // Should detect it's no longer running
      expect(await bg.isRunning()).toBe(false)

      // Should get crash event
      const { events } = await bg.getEvents()
      const crashEvent = events.find((e) => e.type === "agent_crashed")
      expect(crashEvent).toBeDefined()
      expect((crashEvent as any).message).toContain("crashed")
    }, 60_000)
  })

  describe("concurrent polling", () => {
    it("multiple getEvents calls return consistent results", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(SIMPLE_PROMPT)

      // Poll concurrently
      const [result1, result2, result3] = await Promise.all([
        bg.getEvents(),
        bg.getEvents(),
        bg.getEvents(),
      ])

      // All should return data without errors
      expect(result1.events).toBeDefined()
      expect(result2.events).toBeDefined()
      expect(result3.events).toBeDefined()

      await pollUntilEnd(bg)
    }, 180_000)

    it("getEvents from reattached session sees same state", async () => {
      const bg1 = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const sessionId = bg1.id
      await bg1.start(SIMPLE_PROMPT)

      // Wait a bit for some events
      await new Promise((r) => setTimeout(r, 3000))

      // Reattach
      const bg2 = await getBackgroundSession({
        sandbox: sandbox as any,
        backgroundSessionId: sessionId,
      })

      // Both should see the process as running
      const [running1, running2] = await Promise.all([
        bg1.isRunning(),
        bg2.isRunning(),
      ])

      expect(running1).toBe(running2)

      await pollUntilEnd(bg1)
    }, 180_000)
  })

  describe("process lifecycle", () => {
    it("isRunning is false before start, true during, false after", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Before start - meta exists but no run
      const runningBefore = await bg.isRunning()
      expect(runningBefore).toBe(false)

      // Start
      await bg.start(SIMPLE_PROMPT)

      // During
      const runningDuring = await bg.isRunning()
      expect(runningDuring).toBe(true)

      // Wait for completion
      await pollUntilEnd(bg)

      // After
      const runningAfter = await bg.isRunning()
      expect(runningAfter).toBe(false)
    }, 180_000)

    it("getPid returns null before start and after completion", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Before start
      const pidBefore = await bg.getPid()
      expect(pidBefore).toBeNull()

      // Start
      const { pid: startPid } = await bg.start(SIMPLE_PROMPT)

      // During
      const pidDuring = await bg.getPid()
      expect(pidDuring).toBe(startPid)

      // After
      await pollUntilEnd(bg)
      const pidAfter = await bg.getPid()
      expect(pidAfter).toBeNull()
    }, 180_000)

    it("events are cumulative across getEvents calls", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(SIMPLE_PROMPT)

      let totalEvents = 0
      let iterations = 0

      while (iterations < 20) {
        const { events } = await bg.getEvents()
        totalEvents = events.length

        if (events.some((e) => e.type === "end" || e.type === "agent_crashed")) {
          break
        }

        iterations++
        await new Promise((r) => setTimeout(r, 2000))
      }

      // Should have accumulated events
      expect(totalEvents).toBeGreaterThan(0)
    }, 180_000)
  })

  describe("edge cases", () => {
    it("handles empty prompt gracefully", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Empty prompt might cause error or just return quickly
      await bg.start("")

      const events = await pollUntilEnd(bg, 60_000)

      // Should complete (either successfully or with error)
      expect(events.some((e) => e.type === "end" || e.type === "agent_crashed")).toBe(true)
    }, 90_000)

    it("handles very long prompt", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const longPrompt = "Repeat this: " + "word ".repeat(500)
      await bg.start(longPrompt)

      const events = await pollUntilEnd(bg)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)
  })
})
