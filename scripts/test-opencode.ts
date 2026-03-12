#!/usr/bin/env npx tsx
/**
 * Test script for OpenCode provider with local execution
 *
 * Usage: OPENAI_API_KEY=... npx tsx scripts/test-opencode.ts
 */
import { createProvider } from "../src/index.js"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required")
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  OpenCode Provider Test (Local Execution)")
  console.log("============================================================")
  console.log()

  // Create OpenCode provider with dangerous local execution
  const opencode = createProvider("opencode", {
    dangerouslyAllowLocalExecution: true,
  })

  console.log("OpenCode provider created (local execution mode)")
  console.log("Sending test prompt: 'Hello! Can you tell me a short joke?'")
  console.log()
  console.log("------------------------------------------------------------")
  console.log()

  try {
    process.stdout.write("OpenCode: ")

    for await (const event of opencode.run({
      prompt: "Hello! Can you tell me a short joke?",
      env: {
        OPENAI_API_KEY: OPENAI_API_KEY,
      },
      autoInstall: false,
    })) {
      switch (event.type) {
        case "session":
          console.log(`[Session started: ${event.id}]`)
          process.stdout.write("OpenCode: ")
          break
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          console.log(`\n[Using tool: ${event.name}]`)
          break
        case "tool_delta":
          process.stdout.write(event.text)
          break
        case "tool_end":
          console.log("[Tool completed]")
          break
        case "end":
          console.log("\n")
          break
      }
    }

    console.log("------------------------------------------------------------")
    console.log("Test completed successfully!")
  } catch (error) {
    console.error("\nError:", error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Failed to run test:", error)
  process.exit(1)
})
