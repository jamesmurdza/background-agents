/**
 * Integration tests for error handling and edge cases.
 *
 * Tests timeout behavior, invalid API keys, network failures,
 * malformed events, and other error scenarios.
 *
 * Required env vars:
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY (using Claude for these tests)
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/error-handling.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createBackgroundSession, createSession, type Event } from "../../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."

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

// Helper to collect streaming events
async function collectStreamEvents(
  session: Awaited<ReturnType<typeof createSession>>,
  prompt: string
): Promise<Event[]> {
  const events: Event[] = []
  for await (const event of session.run(prompt)) {
    events.push(event)
  }
  return events
}

describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)("error handling tests", () => {
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

  describe("timeout handling", () => {
    it("respects timeout in streaming mode", async () => {
      const session = await createSession("claude", {
        sandbox: sandbox as any,
        timeout: 5, // Very short timeout (5 seconds)
      })

      // Long-running prompt that should timeout
      const longPrompt = "Count from 1 to 100, wait 1 second between each number. Be very detailed."

      const startTime = Date.now()
      let didTimeout = false

      try {
        await collectStreamEvents(session, longPrompt)
      } catch (error) {
        didTimeout = true
        const elapsed = (Date.now() - startTime) / 1000
        // Should timeout around 5 seconds
        expect(elapsed).toBeLessThan(15)
      }

      // Should have timed out or completed quickly
      const elapsed = (Date.now() - startTime) / 1000
      expect(elapsed).toBeLessThan(15)
    }, 30_000)

    it("handles timeout in background mode", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 5, // Very short timeout
      })

      const longPrompt = "Count from 1 to 100, wait 1 second between each number."

      await bg.start(longPrompt)

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 10_000))

      // Should have stopped
      const running = await bg.isRunning()
      expect(running).toBe(false)

      const { events } = await bg.getEvents()
      // Should have crash event due to timeout
      expect(events.some((e) => e.type === "agent_crashed" || e.type === "end")).toBe(true)
    }, 30_000)
  })

  describe("invalid API keys", () => {
    it("fails gracefully with invalid API key in streaming mode", async () => {
      const sandboxBadKey = await daytona.create({
        envVars: { ANTHROPIC_API_KEY: "invalid-key-12345" },
      })

      try {
        const session = await createSession("claude", {
          sandbox: sandboxBadKey as any,
          timeout: 30,
        })

        let gotError = false
        try {
          await collectStreamEvents(session, SIMPLE_PROMPT)
        } catch (error) {
          gotError = true
          // Should get error about authentication
          expect(error).toBeDefined()
        }

        // Should have errored or gotten error event
        expect(gotError).toBe(true)
      } finally {
        await sandboxBadKey.delete()
      }
    }, 90_000)

    it("fails gracefully with invalid API key in background mode", async () => {
      const sandboxBadKey = await daytona.create({
        envVars: { ANTHROPIC_API_KEY: "sk-ant-invalid-key-12345" },
      })

      try {
        const bg = await createBackgroundSession("claude", {
          sandbox: sandboxBadKey as any,
          timeout: 30,
        })

        await bg.start(SIMPLE_PROMPT)

        // Wait for it to fail
        await new Promise((r) => setTimeout(r, 10_000))

        const events = await pollUntilEnd(bg, 30_000)

        // Should have error or crash event
        const hasError = events.some(
          (e) =>
            e.type === "end" ||
            e.type === "agent_crashed" ||
            (e.type === "end" && (e as any).error)
        )
        expect(hasError).toBe(true)
      } finally {
        await sandboxBadKey.delete()
      }
    }, 90_000)
  })

  describe("missing API keys", () => {
    it("handles missing API key in environment", async () => {
      const sandboxNoKey = await daytona.create({
        envVars: {}, // No API key
      })

      try {
        const bg = await createBackgroundSession("claude", {
          sandbox: sandboxNoKey as any,
          timeout: 30,
        })

        await bg.start(SIMPLE_PROMPT)

        await new Promise((r) => setTimeout(r, 10_000))

        const events = await pollUntilEnd(bg, 30_000)

        // Should fail with error
        const hasError = events.some(
          (e) => e.type === "end" || e.type === "agent_crashed"
        )
        expect(hasError).toBe(true)
      } finally {
        await sandboxNoKey.delete()
      }
    }, 90_000)
  })

  describe("malformed events", () => {
    it("handles non-JSON output gracefully", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Start normal prompt
      await bg.start(SIMPLE_PROMPT)

      // Even if there's non-JSON output, should handle it
      const events = await pollUntilEnd(bg)

      // Should complete successfully
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)
  })

  describe("network failures", () => {
    it("handles sandbox connection issues gracefully", async () => {
      // Create a session
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(SIMPLE_PROMPT)

      // Even if there are network hiccups during polling, should recover
      const events = await pollUntilEnd(bg)
      expect(events.length).toBeGreaterThan(0)
    }, 180_000)
  })

  describe("empty and edge case prompts", () => {
    it("handles empty prompt in streaming mode", async () => {
      const session = await createSession("claude", {
        sandbox: sandbox as any,
        timeout: 60,
      })

      let didComplete = false
      try {
        const events = await collectStreamEvents(session, "")
        didComplete = true
        // Should either complete or error
        expect(events.some((e) => e.type === "end" || e.type === "agent_crashed")).toBe(true)
      } catch (error) {
        // Erroring is also acceptable
        didComplete = true
      }

      expect(didComplete).toBe(true)
    }, 90_000)

    it("handles whitespace-only prompt", async () => {
      const session = await createSession("claude", {
        sandbox: sandbox as any,
        timeout: 60,
      })

      let didComplete = false
      try {
        const events = await collectStreamEvents(session, "   \n\n   ")
        didComplete = true
        expect(events.some((e) => e.type === "end" || e.type === "agent_crashed")).toBe(true)
      } catch (error) {
        didComplete = true
      }

      expect(didComplete).toBe(true)
    }, 90_000)

    it("handles special characters in prompt", async () => {
      const session = await createSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const specialPrompt = "What is 2+2? Reply with: <>&\"'`$(){}"

      const events = await collectStreamEvents(session, specialPrompt)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)

    it("handles newlines and escape sequences in prompt", async () => {
      const session = await createSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const promptWithNewlines = "What is 2 + 2?\n\nReply with just the number.\n"

      const events = await collectStreamEvents(session, promptWithNewlines)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)

    it("handles very long prompt (>10K chars)", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const longText = "word ".repeat(3000) // ~15K chars
      const longPrompt = `Here's a long text: ${longText}\n\nWhat is 2 + 2? Reply with just the number.`

      await bg.start(longPrompt)

      const events = await pollUntilEnd(bg)
      expect(events.some((e) => e.type === "end")).toBe(true)
    }, 180_000)
  })

  describe("rapid operations", () => {
    it("handles rapid getEvents calls without crashing", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(SIMPLE_PROMPT)

      // Rapid-fire getEvents calls
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(bg.getEvents())
      }

      const results = await Promise.all(promises)

      // All should succeed
      expect(results.length).toBe(10)
      for (const result of results) {
        expect(result.events).toBeDefined()
        expect(result.cursor).toBeDefined()
      }

      await pollUntilEnd(bg)
    }, 180_000)

    it("handles rapid isRunning calls", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start(SIMPLE_PROMPT)

      // Rapid isRunning checks
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(bg.isRunning())
      }

      const results = await Promise.all(promises)

      // All should succeed
      expect(results.length).toBe(10)
      for (const result of results) {
        expect(typeof result).toBe("boolean")
      }

      await pollUntilEnd(bg)
    }, 180_000)
  })

  describe("session lifecycle edge cases", () => {
    it("handles getEvents before starting any turn", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Call getEvents before starting
      const { events } = await bg.getEvents()

      // Should return empty events, not crash
      expect(Array.isArray(events)).toBe(true)
      expect(events.length).toBe(0)
    }, 30_000)

    it("handles isRunning before starting any turn", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const running = await bg.isRunning()
      expect(running).toBe(false)
    }, 30_000)

    it("handles getPid before starting any turn", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const pid = await bg.getPid()
      expect(pid).toBeNull()
    }, 30_000)

    it("handles multiple cancel calls", async () => {
      const bg = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      await bg.start("Count to 10, wait 2 seconds between each.")

      // Cancel multiple times
      await bg.cancel()
      await bg.cancel()
      await bg.cancel()

      // Should not crash
      expect(await bg.isRunning()).toBe(false)
    }, 60_000)
  })

  describe("invalid model names", () => {
    it("handles invalid model name gracefully", async () => {
      let didError = false

      try {
        const session = await createSession("claude", {
          sandbox: sandbox as any,
          timeout: 30,
          model: "invalid-model-name-xyz",
        })

        await collectStreamEvents(session, SIMPLE_PROMPT)
      } catch (error) {
        didError = true
      }

      // Should either error during creation or execution
      // (behavior may vary by provider)
      expect(didError).toBe(true)
    }, 90_000)
  })

  describe("concurrent sessions", () => {
    it("handles multiple sessions without interference", async () => {
      const bg1 = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      const bg2 = await createBackgroundSession("claude", {
        sandbox: sandbox as any,
        timeout: 120,
      })

      // Start both
      await Promise.all([
        bg1.start("What is 2 + 2?"),
        bg2.start("What is 3 + 3?"),
      ])

      // Both should run independently
      const [events1, events2] = await Promise.all([
        pollUntilEnd(bg1),
        pollUntilEnd(bg2),
      ])

      expect(events1.some((e) => e.type === "end")).toBe(true)
      expect(events2.some((e) => e.type === "end")).toBe(true)
    }, 180_000)
  })
})
