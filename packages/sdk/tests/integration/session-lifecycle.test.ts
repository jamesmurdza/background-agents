/**
 * Integration tests for session lifecycle edge cases: calls before a turn
 * starts, rapid concurrent calls, repeated cancels, and concurrent sessions.
 *
 * These share a single sandbox (no agent API key needed for the pre-start
 * checks; the running cases use Claude).
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/session-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSession } from "../../src/index.js"
import {
  DAYTONA_API_KEY,
  ANTHROPIC_API_KEY,
  SIMPLE_PROMPT,
  pollUntilEnd,
} from "./error-handling-helpers.js"

describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)(
  "session lifecycle",
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

    describe("session lifecycle edge cases", () => {
      it("handles getEvents before starting any turn", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        // Call getEvents before starting
        const { events } = await session.getEvents()

        // Should return empty events, not crash
        expect(Array.isArray(events)).toBe(true)
        expect(events.length).toBe(0)
      }, 30_000)

      it("handles isRunning before starting any turn", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        const running = await session.isRunning()
        expect(running).toBe(false)
      }, 30_000)

      it("handles getPid before starting any turn", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        const pid = await session.getPid()
        expect(pid).toBeNull()
      }, 30_000)

      it("handles multiple cancel calls", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        await session.start("Count to 10, wait 2 seconds between each.")

        // Cancel multiple times
        await session.cancel()
        await session.cancel()
        await session.cancel()

        // Should not crash
        expect(await session.isRunning()).toBe(false)
      }, 60_000)
    })

    describe("rapid operations", () => {
      it("handles rapid getEvents calls without crashing", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        await session.start(SIMPLE_PROMPT)

        // Rapid-fire getEvents calls
        const promises = []
        for (let i = 0; i < 10; i++) {
          promises.push(session.getEvents())
        }

        const results = await Promise.all(promises)

        // All should succeed
        expect(results.length).toBe(10)
        for (const result of results) {
          expect(result.events).toBeDefined()
          expect(result.cursor).toBeDefined()
        }

        await pollUntilEnd(session)
      }, 180_000)

      it("handles rapid isRunning calls", async () => {
        const session = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        await session.start(SIMPLE_PROMPT)

        // Rapid isRunning checks
        const promises = []
        for (let i = 0; i < 10; i++) {
          promises.push(session.isRunning())
        }

        const results = await Promise.all(promises)

        // All should succeed
        expect(results.length).toBe(10)
        for (const result of results) {
          expect(typeof result).toBe("boolean")
        }

        await pollUntilEnd(session)
      }, 180_000)
    })

    describe("concurrent sessions", () => {
      it("handles multiple sessions without interference", async () => {
        const session1 = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        const session2 = await createSession("claude", {
          sandbox,
          timeout: 120,
        })

        // Start both
        await Promise.all([
          session1.start("What is 2 + 2?"),
          session2.start("What is 3 + 3?"),
        ])

        // Both should run independently
        const [events1, events2] = await Promise.all([
          pollUntilEnd(session1),
          pollUntilEnd(session2),
        ])

        expect(events1.some((e) => e.type === "end")).toBe(true)
        expect(events2.some((e) => e.type === "end")).toBe(true)
      }, 180_000)
    })
  }
)
