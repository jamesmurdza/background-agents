#!/usr/bin/env npx tsx
/**
 * Test PTY streaming with real-time output
 */
import { Daytona } from "@daytonaio/sdk"
import { createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!DAYTONA_API_KEY || !ANTHROPIC_API_KEY) {
  console.error("Required environment variables: DAYTONA_API_KEY, ANTHROPIC_API_KEY")
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  PTY Streaming Test - Real-time Output")
  console.log("============================================================")
  console.log()

  console.log("Creating sandbox...")
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY },
  })

  try {
    console.log("Sandbox created!\n")
    console.log("--- Testing Claude via SDK with PTY streaming ---")
    console.log("Prompt: \"Count slowly from 1 to 5\"")
    console.log()

    const provider = createProvider("claude", { sandbox, env: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY } })

    console.log("Response (streaming in real-time):")
    const startTime = Date.now()

    for await (const event of provider.run({
      prompt: "Count from 1 to 5, saying each number on its own line. Be brief.",
      skipInstall: true,
    })) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

      if (event.type === "session") {
        console.log(`  [${elapsed}s] Session: ${event.id.slice(0, 8)}...`)
      } else if (event.type === "token") {
        process.stdout.write(event.text)
      } else if (event.type === "tool_start") {
        console.log(`  [${elapsed}s] Tool: ${event.name}`)
      } else if (event.type === "end") {
        console.log(`\n  [${elapsed}s] Done`)
      }
    }

    console.log("\n✓ PTY streaming test completed!")

  } catch (error) {
    console.error("Error:", error)
    throw error
  } finally {
    console.log("\nDestroying sandbox...")
    await sandbox.delete()
    console.log("Done!")
  }
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
