/**
 * Integration tests for all agents - background mode only.
 *
 * These tests create real Daytona sandboxes and run actual agent CLIs.
 * Skip when required API keys are not set.
 *
 * Required env vars per agent (TEST_ prefixed versions take precedence):
 *   - claude: DAYTONA_API_KEY, ANTHROPIC_API_KEY
 *   - codex: DAYTONA_API_KEY, OPENAI_API_KEY
 *   - gemini: DAYTONA_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY)
 *   - opencode: DAYTONA_API_KEY, ANTHROPIC_API_KEY (or OPENAI_API_KEY)
 *
 * You can use TEST_ prefixed keys (e.g., TEST_OPENAI_API_KEY) to avoid conflicts
 * with running agents.
 *
 * Run all:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/providers.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSession, type Event, type BackgroundSession } from "../../src/index.js"

// Check for TEST_ prefixed keys first, then fall back to regular keys
// This allows running tests with separate keys that don't conflict with running agents
const DAYTONA_API_KEY =
  process.env.TEST_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY =
  process.env.TEST_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY =
  process.env.TEST_OPENAI_API_KEY || process.env.OPENAI_API_KEY
const GEMINI_API_KEY =
  process.env.TEST_GEMINI_API_KEY ||
  process.env.TEST_GOOGLE_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY

// Simple prompt that should complete quickly
const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."

// Agent configurations
const agents = [
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
  session: BackgroundSession,
  timeoutMs = 120_000,
  pollIntervalMs = 2000
): Promise<Event[]> {
  const deadline = Date.now() + timeoutMs
  let allEvents: Event[] = []

  while (Date.now() < deadline) {
    const { events, running } = await session.getEvents()
    allEvents = events
    if (!running || events.some((e) => e.type === "end")) break
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return allEvents
}

describe.skipIf(!DAYTONA_API_KEY)("agent integration tests", () => {
  // Test each agent
  for (const agent of agents) {
    const hasRequiredKeys = DAYTONA_API_KEY && agent.hasKey

    describe.skipIf(!hasRequiredKeys)(`${agent.name}`, () => {
      let daytona: Daytona
      let sandbox: Sandbox

      beforeAll(async () => {
        daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
        sandbox = await daytona.create({
          envVars: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })
      }, 60_000)

      afterAll(async () => {
        if (sandbox) {
          await sandbox.delete()
        }
      }, 30_000)

      it("completes a simple prompt and returns events", async () => {
        const session = await createSession(agent.name, {
          sandbox: sandbox as any,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        const startResult = await session.start(SIMPLE_PROMPT)

        expect(startResult.pid).toBeGreaterThan(0)
        expect(startResult.outputFile).toBeDefined()

        const events = await pollUntilEnd(session)

        expect(events.length).toBeGreaterThan(0)
        expect(events.some((e) => e.type === "end")).toBe(true)
        // Should have some token events with the answer
        expect(events.some((e) => e.type === "token")).toBe(true)
      }, 180_000)

      it("isRunning transitions from true to false", async () => {
        const session = await createSession(agent.name, {
          sandbox: sandbox as any,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        await session.start(SIMPLE_PROMPT)

        // Should be running right after start
        const runningAfterStart = await session.isRunning()
        expect(runningAfterStart).toBe(true)

        // Wait for completion
        await pollUntilEnd(session)

        // Should not be running after completion
        const runningAfterEnd = await session.isRunning()
        expect(runningAfterEnd).toBe(false)
      }, 180_000)

      it("getPid returns pid while running, null after", async () => {
        const session = await createSession(agent.name, {
          sandbox: sandbox as any,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        const { pid: startPid } = await session.start(SIMPLE_PROMPT)
        const getPidResult = await session.getPid()
        expect(getPidResult).toBe(startPid)

        await pollUntilEnd(session)

        const pidAfterEnd = await session.getPid()
        expect(pidAfterEnd).toBeNull()
      }, 180_000)

      it("yields session event with id", async () => {
        const session = await createSession(agent.name, {
          sandbox: sandbox as any,
          timeout: 120,
          model: agent.model,
          env: { [agent.apiKeyEnvVar]: agent.apiKey! },
        })

        await session.start(SIMPLE_PROMPT)
        const events = await pollUntilEnd(session)

        const sessionEvent = events.find((e) => e.type === "session")
        expect(sessionEvent).toBeDefined()
        expect((sessionEvent as any).id).toBeDefined()
      }, 180_000)
    })
  }
})
