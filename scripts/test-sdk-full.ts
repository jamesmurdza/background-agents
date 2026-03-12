#!/usr/bin/env npx tsx
/**
 * Full SDK test
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
  console.log("Code Agent SDK - Full Test")
  console.log("============================================================")

  console.log("\n1. Creating sandbox with ANTHROPIC_API_KEY...")
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY },
  })
  console.log("   ✓ Sandbox created")

  try {
    console.log("\n2. Creating Claude provider...")
    const provider = createProvider("claude", { sandbox, env: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY } })
    console.log("   ✓ Provider created")

    // Test collectText
    console.log("\n3. Testing collectText...")
    console.log("   Prompt: \"Say 'Test passed!'\"")

    const text = await provider.collectText({
      prompt: "Say 'Test passed!' and nothing else.",
      skipInstall: true, // CLI is already installed
    })

    console.log("   Response:", text)

    if (text.includes("Test passed")) {
      console.log("   ✓ SUCCESS!")
    }

    // Test streaming events
    console.log("\n4. Testing streaming events...")
    console.log("   Prompt: \"Count from 1 to 3\"")

    const events: string[] = []
    for await (const event of provider.run({
      prompt: "Count from 1 to 3, one number per line.",
      skipInstall: true,
    })) {
      events.push(`${event.type}: ${event.type === "token" ? event.text : JSON.stringify(event)}`)
      if (event.type === "token") {
        process.stdout.write(event.text)
      }
    }
    console.log()
    console.log("   Events received:", events.length)
    console.log("   ✓ Streaming test passed!")

  } finally {
    console.log("\n5. Destroying sandbox...")
    await sandbox.delete()
    console.log("   ✓ Sandbox destroyed")
  }

  console.log("\n============================================================")
  console.log("All tests passed!")
  console.log("============================================================")
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
