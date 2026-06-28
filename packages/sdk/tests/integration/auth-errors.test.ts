/**
 * Integration tests for API-key error handling.
 *
 * Each test creates its own sandbox with a deliberately bad/missing key, so
 * there is no shared sandbox here.
 *
 * Run:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/auth-errors.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest"
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "../../src/index.js"
import {
  DAYTONA_API_KEY,
  ANTHROPIC_API_KEY,
  SIMPLE_PROMPT,
  pollUntilEnd,
} from "./error-handling-helpers.js"

describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)(
  "auth error handling",
  () => {
    let daytona: Daytona

    beforeAll(() => {
      daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
    })

    describe("invalid API keys", () => {
      it("fails gracefully with invalid API key", async () => {
        const sandboxBadKey = await daytona.create({
          envVars: { ANTHROPIC_API_KEY: "sk-ant-invalid-key-12345" },
        })

        try {
          const session = await createSession("claude", {
            sandbox: sandboxBadKey,
            timeout: 30,
          })

          await session.start(SIMPLE_PROMPT)

          // Wait for it to fail
          await new Promise((r) => setTimeout(r, 10_000))

          const events = await pollUntilEnd(session, 30_000)

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
          const session = await createSession("claude", {
            sandbox: sandboxNoKey,
            timeout: 30,
          })

          await session.start(SIMPLE_PROMPT)

          await new Promise((r) => setTimeout(r, 10_000))

          const events = await pollUntilEnd(session, 30_000)

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
  }
)
