#!/usr/bin/env npx tsx
/**
 * Simple test script for OpenCode provider with OpenAI API key
 */
import { createSandbox, createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!DAYTONA_API_KEY) {
  console.error("Error: DAYTONA_API_KEY environment variable is required")
  process.exit(1)
}

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required")
  process.exit(1)
}

async function main() {
  console.log("=".repeat(60))
  console.log("  OpenCode Provider Test with OpenAI API Key")
  console.log("=".repeat(60))
  console.log()

  console.log("Creating sandbox...")
  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: {
      OPENAI_API_KEY: OPENAI_API_KEY,
    },
  })

  try {
    await sandbox.create()
    console.log("✓ Sandbox created!")
    console.log()

    console.log("Creating OpenCode provider...")
    const provider = createProvider("opencode", { sandbox })
    console.log("✓ OpenCode provider ready!")
    console.log()

    const prompt = "What is 2 + 2? Just give me the number."
    console.log(`Sending prompt: "${prompt}"`)
    console.log("-".repeat(60))
    console.log()

    let response = ""
    let eventCount = 0

    for await (const event of provider.run({ prompt, autoInstall: true })) {
      eventCount++
      console.log(`[Event ${eventCount}] Type: ${event.type}`)

      if (event.type === "token") {
        response += event.text
        process.stdout.write(event.text)
      } else if (event.type === "session") {
        console.log(`  Session ID: ${event.id}`)
      } else if (event.type === "tool_start") {
        console.log(`  Tool: ${event.name}`)
      } else if (event.type === "tool_delta") {
        console.log(`  Delta: ${event.text.substring(0, 50)}...`)
      } else if (event.type === "tool_end") {
        console.log("  Tool completed")
      } else if (event.type === "end") {
        console.log("  Run completed")
      }
    }

    console.log()
    console.log("-".repeat(60))
    console.log()
    console.log(`Total events received: ${eventCount}`)
    console.log(`Full response: "${response}"`)
    console.log()
    console.log("✓ Test completed successfully!")

  } catch (error) {
    console.error("✗ Error:", error)
    throw error
  } finally {
    console.log()
    console.log("Destroying sandbox...")
    await sandbox.destroy()
    console.log("✓ Sandbox destroyed!")
  }
}

main().catch((error) => {
  console.error("Failed to run test:", error)
  process.exit(1)
})
