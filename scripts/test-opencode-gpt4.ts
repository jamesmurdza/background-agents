#!/usr/bin/env npx tsx
/**
 * Test OpenCode with GPT-4o model (which should support all verbosity levels)
 */
import { Daytona } from "@daytonaio/sdk"

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
  console.log("  OpenCode Test with GPT-4o")
  console.log("=".repeat(60))
  console.log()

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })

  console.log("Creating sandbox...")
  const sandbox = await daytona.create({
    language: "typescript",
    envVars: {
      OPENAI_API_KEY: OPENAI_API_KEY,
    },
  })

  try {
    console.log("✓ Sandbox created!")
    console.log()

    // Try running opencode with a specific model
    console.log("Running opencode with GPT-4o model...")
    console.log("-".repeat(60))

    const prompt = "What is 2 + 2? Just reply with the number."
    const command = `export OPENAI_API_KEY='${OPENAI_API_KEY}'; opencode run --format json --model openai/gpt-4o '${prompt}'`

    let output = ""
    const ptyId = `test-${Date.now()}`

    const ptyHandle = await sandbox.process.createPty({
      id: ptyId,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        output += text
        // Print only JSON lines for clarity
        const lines = text.split("\n")
        for (const line of lines) {
          if (line.includes('"type":')) {
            // Parse and print nicely
            try {
              const json = JSON.parse(line.trim())
              console.log(`[${json.type}]`, JSON.stringify(json).substring(0, 200))
            } catch {
              console.log(line)
            }
          }
        }
      },
    })

    await ptyHandle.waitForConnection()
    console.log("[PTY Connected]\n")

    await ptyHandle.sendInput(`${command}\n`)

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 45000))

    await ptyHandle.sendInput("\x03")
    await ptyHandle.sendInput("exit\n")
    await ptyHandle.disconnect()

    console.log("\n" + "-".repeat(60))
    console.log("Test completed!")

  } catch (error) {
    console.error("✗ Error:", error)
    throw error
  } finally {
    console.log()
    console.log("Destroying sandbox...")
    await sandbox.delete()
    console.log("✓ Sandbox destroyed!")
  }
}

main().catch((error) => {
  console.error("Failed to run test:", error)
  process.exit(1)
})
