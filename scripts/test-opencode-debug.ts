#!/usr/bin/env npx tsx
/**
 * Debug test script for OpenCode provider
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
  console.log("  OpenCode Debug Test")
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

    // Check if opencode is installed
    console.log("Checking if opencode is installed...")
    const whichResult = await sandbox.process.executeCommand("which opencode")
    console.log(`which opencode: exit=${whichResult.exitCode}, result=${whichResult.result}`)

    if (whichResult.exitCode !== 0) {
      console.log("Installing opencode...")
      const installResult = await sandbox.process.executeCommand("npm install -g opencode", undefined, undefined, 120)
      console.log(`Install result: exit=${installResult.exitCode}`)
      console.log(installResult.result?.substring(0, 500))
    }

    // Check opencode version
    console.log("\nChecking opencode version...")
    const versionResult = await sandbox.process.executeCommand("opencode --version 2>&1")
    console.log(`Version: ${versionResult.result}`)

    // Try running opencode directly with the command
    console.log("\n" + "=".repeat(60))
    console.log("Running opencode with prompt...")
    console.log("=".repeat(60))

    const prompt = "What is 2 + 2? Just reply with the number."
    const command = `export OPENAI_API_KEY='${OPENAI_API_KEY}'; opencode run --format json '${prompt}'`

    console.log(`Command: opencode run --format json '${prompt}'`)
    console.log()

    // Use PTY for streaming
    let output = ""
    const ptyId = `debug-${Date.now()}`

    const ptyHandle = await sandbox.process.createPty({
      id: ptyId,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        output += text
        process.stdout.write(text)
      },
    })

    await ptyHandle.waitForConnection()
    console.log("[PTY Connected]")

    await ptyHandle.sendInput(`${command}\n`)

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 30000))

    await ptyHandle.sendInput("\x03") // Ctrl+C to stop
    await ptyHandle.sendInput("exit\n")

    await ptyHandle.disconnect()

    console.log("\n" + "=".repeat(60))
    console.log("Raw output length:", output.length)
    console.log("=".repeat(60))

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
