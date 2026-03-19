/**
 * Integration tests for all providers - background and streaming modes.
 *
 * These tests create real Daytona sandboxes and run actual provider CLIs.
 * Skip when required API keys are not set.
 *
 * Required env vars per provider:
 *   - claude: DAYTONA_API_KEY, ANTHROPIC_API_KEY
 *   - codex: DAYTONA_API_KEY, OPENAI_API_KEY
 *   - gemini: DAYTONA_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY)
 *   - opencode: DAYTONA_API_KEY, ANTHROPIC_API_KEY (or OPENAI_API_KEY)
 *
 * Run all:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/providers.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSession, createBackgroundSession, type Event } from "../../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

// Simple prompt that should complete quickly
const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."

// Provider configurations
const providers = [
  {
    name: "claude" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    apiKey: ANTHROPIC_API_KEY,
    hasKey: !!ANTHROPIC_API_KEY,
  },
  {
    name: "codex" as const,
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKey: OPENAI_API_KEY,
    hasKey: !!OPENAI_API_KEY,
  },
  {
    name: "gemini" as const,
    apiKeyEnvVar: "GEMINI_API_KEY",
    apiKey: GEMINI_API_KEY,
    hasKey: !!GEMINI_API_KEY,
  },
  {
    name: "opencode" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY", // opencode can use multiple, we use anthropic
    apiKey: ANTHROPIC_API_KEY,
    hasKey: !!ANTHROPIC_API_KEY,
    model: "anthropic/claude-sonnet-4-6",
  },
]

// Helper to poll for completion
async function pollUntilEnd(
  bg: Awaited<ReturnType<typeof createBackgroundSession>>,
  timeoutMs = 120_000,
  pollIntervalMs = 2000
): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs
  let allEvents: Event[] = []

  while (Date.now() < deadline) {
    const { events } = await bg.getEvents()
    allEvents = events
    if (events.some((e) => e.type === "end")) break
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

describe.skipIf(!DAYTONA_API_KEY)("provider integration tests", () => {
  // Test each provider
  for (const provider of providers) {
    const hasRequiredKeys = DAYTONA_API_KEY && provider.hasKey

    describe.skipIf(!hasRequiredKeys)(`${provider.name}`, () => {
      let daytona: Daytona
      let sandbox: Sandbox

      beforeAll(async () => {
        daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
        sandbox = await daytona.create({
          envVars: { [provider.apiKeyEnvVar]: provider.apiKey! },
        })
      }, 60_000)

      afterAll(async () => {
        if (sandbox) {
          await sandbox.delete()
        }
      }, 30_000)

      describe("background mode", () => {
        it("completes a simple prompt and returns events", async () => {
          const bg = await createBackgroundSession(provider.name, {
            sandbox: sandbox as any,
            timeout: 120,
            model: provider.model,
            env: { [provider.apiKeyEnvVar]: provider.apiKey! },
          })

          const startResult = await bg.start(SIMPLE_PROMPT)

          expect(startResult.pid).toBeGreaterThan(0)
          expect(startResult.outputFile).toBeDefined()

          const events = await pollUntilEnd(bg)

          expect(events.length).toBeGreaterThan(0)
          expect(events.some((e) => e.type === "end")).toBe(true)
          // Should have some token events with the answer
          expect(events.some((e) => e.type === "token")).toBe(true)
        }, 180_000)

        it("isRunning transitions from true to false", async () => {
          const bg = await createBackgroundSession(provider.name, {
            sandbox: sandbox as any,
            timeout: 120,
            model: provider.model,
            env: { [provider.apiKeyEnvVar]: provider.apiKey! },
          })

          await bg.start(SIMPLE_PROMPT)

          // Should be running right after start
          const runningAfterStart = await bg.isRunning()
          expect(runningAfterStart).toBe(true)

          // Wait for completion
          await pollUntilEnd(bg)

          // Should not be running after completion
          const runningAfterEnd = await bg.isRunning()
          expect(runningAfterEnd).toBe(false)
        }, 180_000)

        it("getPid returns pid while running, null after", async () => {
          const bg = await createBackgroundSession(provider.name, {
            sandbox: sandbox as any,
            timeout: 120,
            model: provider.model,
            env: { [provider.apiKeyEnvVar]: provider.apiKey! },
          })

          const { pid: startPid } = await bg.start(SIMPLE_PROMPT)
          const getPidResult = await bg.getPid()
          expect(getPidResult).toBe(startPid)

          await pollUntilEnd(bg)

          const pidAfterEnd = await bg.getPid()
          expect(pidAfterEnd).toBeNull()
        }, 180_000)
      })

      describe("streaming mode", () => {
        it("streams events for a simple prompt", async () => {
          const session = await createSession(provider.name, {
            sandbox: sandbox as any,
            timeout: 120,
            model: provider.model,
            env: { [provider.apiKeyEnvVar]: provider.apiKey! },
          })

          const events = await collectStreamEvents(session, SIMPLE_PROMPT)

          expect(events.length).toBeGreaterThan(0)
          expect(events.some((e) => e.type === "end")).toBe(true)
          expect(events.some((e) => e.type === "token")).toBe(true)
        }, 180_000)

        it("yields session event with id", async () => {
          const session = await createSession(provider.name, {
            sandbox: sandbox as any,
            timeout: 120,
            model: provider.model,
            env: { [provider.apiKeyEnvVar]: provider.apiKey! },
          })

          const events = await collectStreamEvents(session, SIMPLE_PROMPT)

          const sessionEvent = events.find((e) => e.type === "session")
          expect(sessionEvent).toBeDefined()
          expect((sessionEvent as any).id).toBeDefined()
        }, 180_000)
      })
    })
  }
})
