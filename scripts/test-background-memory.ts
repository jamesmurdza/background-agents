#!/usr/bin/env npx tsx

/**
 * Quick integration test to verify background session memory
 * using the same SDK behavior this app relies on.
 *
 * Usage:
 *   DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/test-background-memory.ts
 */

import { Daytona } from "@daytonaio/sdk"
import {
  createBackgroundSession,
  getBackgroundSession,
  type BackgroundSession,
  type Event,
} from "../dist/index.js"

async function drainAllEvents(bg: BackgroundSession): Promise<Event[]> {
  const events: Event[] = []
  let sawEnd = false

  for (let i = 0; i < 60; i++) {
    const { events: batch } = await bg.getEvents()
    events.push(...batch)
    if (batch.some(e => e.type === "end")) {
      sawEnd = true
      break
    }
    const running = await bg.isRunning()
    if (!running) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!sawEnd) {
    const { events: finalBatch } = await bg.getEvents()
    events.push(...finalBatch)
  }

  return events
}

async function main() {
  const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

  if (!DAYTONA_API_KEY || !ANTHROPIC_API_KEY) {
    console.error(
      "DAYTONA_API_KEY and ANTHROPIC_API_KEY must be set to run this test."
    )
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY },
  })

  try {
    const systemPrompt =
      "You are a helpful coding assistant. Answer succinctly."

    const bg = await createBackgroundSession("claude", {
      // Cast to align local Daytona Sandbox type with the SDK's internal Sandbox type.
      sandbox: sandbox as any,
      systemPrompt,
      timeout: 120,
    })

    console.log("Background session ID:", bg.id)

    const backgroundSessionId = bg.id
    const sandboxId = sandbox.id

    // First turn uses the initially created sandbox/session.
    await bg.start("My name is James.")
    await drainAllEvents(bg)

    // Second turn simulates reconnect by refetching the sandbox and background session.
    const sandboxForSecondTurn = await daytona.get(sandboxId)
    const bgReattached = await getBackgroundSession({
      // Cast to avoid type mismatch between the local Daytona SDK Sandbox type
      // and the SDK's internal Sandbox type used in the coding-agents package.
      sandbox: sandboxForSecondTurn as any,
      backgroundSessionId,
      systemPrompt,
      timeout: 120,
    })

    await bgReattached.start("What is my name?")
    const events = await drainAllEvents(bgReattached)

    const combinedText = events
      .filter(e => e.type === "token")
      .map(e => (e as any).text as string)
      .join(" ")
      .toLowerCase()

    console.log("Combined token text:\n", combinedText)

    if (combinedText.includes("james")) {
      console.log("✅ Background memory test passed (found 'james').")
      process.exit(0)
    } else {
      console.error("❌ Background memory test FAILED (did not find 'james').")
      process.exit(1)
    }
  } finally {
    await sandbox.delete()
  }
}

main().catch(err => {
  console.error("Error running background memory test:", err)
  process.exit(1)
})

