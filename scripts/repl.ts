#!/usr/bin/env npx tsx
/**
 * Interactive REPL for testing the Code Agent SDK
 */
import * as readline from "node:readline"
import { createSandbox, createProvider, type Provider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!DAYTONA_API_KEY || !ANTHROPIC_API_KEY) {
  console.error("Required environment variables: DAYTONA_API_KEY, ANTHROPIC_API_KEY")
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  Code Agent SDK - Interactive REPL")
  console.log("============================================================")
  console.log()
  console.log("Creating sandbox...")

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: {
      ANTHROPIC_API_KEY: ANTHROPIC_API_KEY,
    },
  })

  await sandbox.create()
  console.log("Sandbox created!")
  console.log()

  const provider = createProvider("claude", { sandbox })
  console.log("Claude provider ready.")
  console.log()
  console.log("Commands:")
  console.log("  Type a prompt and press Enter to send to Claude")
  console.log("  /quit or /exit - Exit the REPL")
  console.log("  /clear - Clear session (start fresh)")
  console.log("------------------------------------------------------------")
  console.log()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question("\x1b[36mYou:\x1b[0m ", async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        prompt()
        return
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log("\nDestroying sandbox...")
        await sandbox.destroy()
        console.log("Goodbye!")
        rl.close()
        process.exit(0)
      }

      if (trimmed === "/clear") {
        provider.sessionId = null
        console.log("Session cleared.\n")
        prompt()
        return
      }

      try {
        // Show thinking indicator
        process.stdout.write("\x1b[90mThinking...\x1b[0m")
        let firstToken = true

        for await (const event of provider.run({ prompt: trimmed, autoInstall: false })) {
          if (event.type === "token") {
            if (firstToken) {
              // Clear "Thinking..." and show Claude's response
              process.stdout.write("\r\x1b[K\x1b[33mClaude:\x1b[0m ")
              firstToken = false
            }
            process.stdout.write(event.text)
          } else if (event.type === "tool_start") {
            if (firstToken) {
              process.stdout.write("\r\x1b[K")
              firstToken = false
            }
            process.stdout.write(`\x1b[90m[Using tool: ${event.name}]\x1b[0m\n`)
          } else if (event.type === "tool_end") {
            process.stdout.write(`\x1b[90m[Tool completed]\x1b[0m\n`)
          }
        }

        console.log("\n")
      } catch (error) {
        console.error("\n\x1b[31mError:\x1b[0m", error)
        console.log()
      }

      prompt()
    })
  }

  // Handle Ctrl+C gracefully
  rl.on("close", async () => {
    console.log("\nDestroying sandbox...")
    await sandbox.destroy()
    console.log("Goodbye!")
    process.exit(0)
  })

  prompt()
}

main().catch((error) => {
  console.error("Failed to start REPL:", error)
  process.exit(1)
})
