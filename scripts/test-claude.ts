#!/usr/bin/env npx tsx
/**
 * Integration test for Claude provider
 */
import { createProvider } from "../src/index.js"
import * as dotenv from "dotenv"

dotenv.config()

async function main() {
  console.log("Testing Claude provider...")
  console.log("=" .repeat(50))

  const provider = createProvider("claude")

  console.log("\nStarting Claude with a simple prompt...")
  console.log("-".repeat(50))

  try {
    for await (const event of provider.run({
      prompt: "Say 'Hello from Claude!' and nothing else.",
      persistSession: false,
    })) {
      switch (event.type) {
        case "session":
          console.log(`\n[SESSION] ${event.id}`)
          break
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          console.log(`\n[TOOL_START] ${event.name}`)
          break
        case "tool_delta":
          process.stdout.write(event.text)
          break
        case "tool_end":
          console.log(`\n[TOOL_END]`)
          break
        case "end":
          console.log(`\n[END]`)
          break
      }
    }

    console.log("\n" + "=".repeat(50))
    console.log("Claude test completed successfully!")
  } catch (error) {
    console.error("\nError:", error)
    process.exit(1)
  }
}

main()
