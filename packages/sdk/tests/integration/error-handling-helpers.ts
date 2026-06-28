/**
 * Shared setup for the error-handling integration suites
 * (auth-errors, session-lifecycle, edge-cases).
 *
 * Required env vars (TEST_ prefixed versions take precedence):
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY (using Claude for these tests)
 */
import "dotenv/config"
import type { Event, BackgroundSession } from "../../src/index.js"

// Check for TEST_ prefixed keys first, then fall back to regular keys
export const DAYTONA_API_KEY =
  process.env.TEST_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY
export const ANTHROPIC_API_KEY =
  process.env.TEST_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY

export const SIMPLE_PROMPT = "What is 2 + 2? Reply with just the number."

// Poll until an end/crash event arrives or the timeout elapses.
export async function pollUntilEnd(
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
