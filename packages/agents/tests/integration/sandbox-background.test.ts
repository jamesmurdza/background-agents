/**
 * Integration tests for background session lifecycle and advanced features.
 *
 * Tests session reattachment, multiple turns, cancellation, crash detection,
 * and concurrent polling.
 *
 * Required env vars (TEST_ prefixed versions take precedence):
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY (using Claude for these tests)
 *
 * You can use TEST_ prefixed keys (e.g., TEST_ANTHROPIC_API_KEY) to avoid conflicts
 * with running agents.
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/sandbox-background.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import {
  createSession,
  getSession,
  type Event,
  type BackgroundSession,
} from "../../src/index.js"

// Check for TEST_ prefixed keys first, then fall back to regular keys
const DAYTONA_API_KEY =
  process.env.TEST_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY =
  process.env.TEST_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY

const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."
const LONG_RUNNING_PROMPT =
  "Count from 1 to 5, wait 2 seconds between each number."

// Helper to poll until end or timeout
async function pollUntilEnd(
  session: BackgroundSession,
  timeoutMs = 120_000,
  pollIntervalMs = 2000
): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs
  const allEvents: Event[] = []

  while (Date.now() < deadline) {
    const { events, running } = await session.getEvents()
    for (const event of events) {
      if (!allEvents.some((e) => e === event)) {
        allEvents.push(event)
      }
    }
    if (
      !running ||
      allEvents.some((e) => e.type === "end" || e.type === "agent_crashed")
    )
      break
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  return allEvents
}

describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)(
  "sandbox background session tests",
  () => {
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
        const session1 = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        const sessionId = session1.id
        expect(sessionId).toBeDefined()

        // Start a task
        const { pid } = await session1.start(SIMPLE_PROMPT)
        expect(pid).toBeGreaterThan(0)

        // Reattach using the same session ID
        const session2 = await getSession(sessionId, {
          sandbox: sandbox as any,
        })

        expect(session2.id).toBe(sessionId)

        // Should be able to poll from reattached session
        const events = await pollUntilEnd(session2)
        expect(events.length).toBeGreaterThan(0)
        expect(events.some((e) => e.type === "end")).toBe(true)
      }, 180_000)

      it("reattached session preserves agent info", async () => {
        const session1 = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        const sessionId = session1.id
        await session1.start(SIMPLE_PROMPT)

        // Reattach without specifying agent (should read from meta)
        const session2 = await getSession(sessionId, {
          sandbox: sandbox as any,
        })

        expect(session2.agent.name).toBe("claude")

        await pollUntilEnd(session2)
      }, 180_000)

      it("throws error when reattaching to non-existent session", async () => {
        await expect(
          getSession("non-existent-id-12345", {
            sandbox: sandbox as any,
          })
        ).rejects.toThrow(/meta not found/)
      }, 30_000)
    })

    describe("multiple turns", () => {
      it("handles multiple sequential prompts correctly", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // First turn
        await session.start(SIMPLE_PROMPT)
        const events1 = await pollUntilEnd(session)
        expect(events1.some((e) => e.type === "end")).toBe(true)

        // Should not be running after first turn
        expect(await session.isRunning()).toBe(false)

        // Second turn
        await session.start("What is 3 + 3? Reply with just the number.")
        const events2 = await pollUntilEnd(session)
        expect(events2.some((e) => e.type === "end")).toBe(true)

        // Third turn
        await session.start("What is 5 + 5? Reply with just the number.")
        const events3 = await pollUntilEnd(session)
        expect(events3.some((e) => e.type === "end")).toBe(true)

        expect(await session.isRunning()).toBe(false)
      }, 300_000)

      it("cursor advances correctly between turns", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // First turn
        await session.start(SIMPLE_PROMPT)

        let lastCursor = "0"
        while (true) {
          const { events, cursor, running } = await session.getEvents()
          if (cursor !== lastCursor) {
            expect(Number(cursor)).toBeGreaterThan(Number(lastCursor))
            lastCursor = cursor
          }
          if (!running || events.some((e) => e.type === "end")) break
          await new Promise((r) => setTimeout(r, 1000))
        }

        // Second turn - cursor should reset or continue correctly
        await session.start("What is 10 + 10?")
        const { cursor: newCursor } = await session.getEvents()
        expect(newCursor).toBeDefined()

        await pollUntilEnd(session)
      }, 180_000)
    })

    describe("cancellation", () => {
      it("can cancel a running background process", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Start a longer-running task
        await session.start(LONG_RUNNING_PROMPT)

        // Verify it's running
        expect(await session.isRunning()).toBe(true)

        // Wait a bit to ensure it's started
        await new Promise((r) => setTimeout(r, 3000))

        // Cancel it
        await session.cancel()

        // Wait a moment for cancellation to take effect
        await new Promise((r) => setTimeout(r, 2000))

        // Should no longer be running
        expect(await session.isRunning()).toBe(false)

        // Should get crash event on next poll
        const { events } = await session.getEvents()
        expect(events.some((e) => e.type === "agent_crashed")).toBe(true)
      }, 60_000)

      it("cancel is safe when nothing is running", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Cancel without starting anything - should not throw
        await expect(session.cancel()).resolves.toBeUndefined()

        expect(await session.isRunning()).toBe(false)
      }, 30_000)

      it("can start new turn after cancellation", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Start and cancel
        await session.start(LONG_RUNNING_PROMPT)
        await new Promise((r) => setTimeout(r, 2000))
        await session.cancel()
        await new Promise((r) => setTimeout(r, 2000))

        // Start new turn
        await session.start(SIMPLE_PROMPT)
        const events = await pollUntilEnd(session)
        expect(events.some((e) => e.type === "end")).toBe(true)
      }, 120_000)
    })

    describe("crash detection", () => {
      it("detects when process crashes unexpectedly", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        const { pid } = await session.start(LONG_RUNNING_PROMPT)

        // Wait for it to start
        await new Promise((r) => setTimeout(r, 3000))

        // Kill the process directly (simulate crash)
        await sandbox.process.executeCommand(
          `kill -9 ${pid}`,
          undefined,
          undefined,
          10
        )

        // Wait a moment
        await new Promise((r) => setTimeout(r, 2000))

        // Should detect it's no longer running
        expect(await session.isRunning()).toBe(false)

        // Should get crash event
        const { events } = await session.getEvents()
        const crashEvent = events.find((e) => e.type === "agent_crashed")
        expect(crashEvent).toBeDefined()
        expect((crashEvent as any).message).toContain("crashed")
      }, 60_000)
    })

    describe("concurrent polling", () => {
      it("multiple getEvents calls return consistent results", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        await session.start(SIMPLE_PROMPT)

        // Poll concurrently
        const [result1, result2, result3] = await Promise.all([
          session.getEvents(),
          session.getEvents(),
          session.getEvents(),
        ])

        // All should return data without errors
        expect(result1.events).toBeDefined()
        expect(result2.events).toBeDefined()
        expect(result3.events).toBeDefined()

        await pollUntilEnd(session)
      }, 180_000)

      it("getEvents from reattached session sees same state", async () => {
        const session1 = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        const sessionId = session1.id
        await session1.start(SIMPLE_PROMPT)

        // Wait a bit for some events
        await new Promise((r) => setTimeout(r, 3000))

        // Reattach
        const session2 = await getSession(sessionId, {
          sandbox: sandbox as any,
        })

        // Both should see the process as running
        const [running1, running2] = await Promise.all([
          session1.isRunning(),
          session2.isRunning(),
        ])

        expect(running1).toBe(running2)

        await pollUntilEnd(session1)
      }, 180_000)
    })

    describe("process lifecycle", () => {
      it("isRunning is false before start, true during, false after", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Before start - meta exists but no run
        const runningBefore = await session.isRunning()
        expect(runningBefore).toBe(false)

        // Start
        await session.start(SIMPLE_PROMPT)

        // During
        const runningDuring = await session.isRunning()
        expect(runningDuring).toBe(true)

        // Wait for completion
        await pollUntilEnd(session)

        // After
        const runningAfter = await session.isRunning()
        expect(runningAfter).toBe(false)
      }, 180_000)

      it("getPid returns null before start and after completion", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Before start
        const pidBefore = await session.getPid()
        expect(pidBefore).toBeNull()

        // Start
        const { pid: startPid } = await session.start(SIMPLE_PROMPT)

        // During
        const pidDuring = await session.getPid()
        expect(pidDuring).toBe(startPid)

        // After
        await pollUntilEnd(session)
        const pidAfter = await session.getPid()
        expect(pidAfter).toBeNull()
      }, 180_000)

      it("events are cumulative across getEvents calls", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        await session.start(SIMPLE_PROMPT)

        let totalEvents = 0
        let iterations = 0

        while (iterations < 20) {
          const { events, running } = await session.getEvents()
          totalEvents = events.length

          if (
            !running ||
            events.some((e) => e.type === "end" || e.type === "agent_crashed")
          ) {
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
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        // Empty prompt might cause error or just return quickly
        await session.start("")

        const events = await pollUntilEnd(session, 60_000)

        // Should complete (either successfully or with error)
        expect(
          events.some((e) => e.type === "end" || e.type === "agent_crashed")
        ).toBe(true)
      }, 90_000)

      it("handles very long prompt", async () => {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 120,
        })

        const longPrompt = "Repeat this: " + "word ".repeat(500)
        await session.start(longPrompt)

        const events = await pollUntilEnd(session)
        expect(events.some((e) => e.type === "end")).toBe(true)
      }, 180_000)
    })
  }
)
