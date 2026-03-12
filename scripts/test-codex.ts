#!/usr/bin/env npx tsx
/**
 * Test Codex provider
 */
import { Daytona } from "@daytonaio/sdk"
import { createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!DAYTONA_API_KEY || !OPENAI_API_KEY) {
  console.error("Required environment variables: DAYTONA_API_KEY, OPENAI_API_KEY")
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  Codex Provider Test")
  console.log("============================================================")
  console.log()

  console.log("Creating sandbox...")
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { OPENAI_API_KEY: OPENAI_API_KEY },
  })

  try {
    console.log("Sandbox created!")

    console.log("\nInstalling Codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("Installed!")

    console.log("\nLogging in to Codex...")
    const loginResult = await sandbox.process.executeCommand(
      `echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`,
      undefined,
      undefined,
      30
    )
    console.log("Login result:", (loginResult.result ?? "").trim())

    console.log("\n--- Testing Codex via SDK ---")
    console.log("Prompt: \"Say hello briefly\"")
    console.log()

    const provider = createProvider("codex", { sandbox, env: { OPENAI_API_KEY: OPENAI_API_KEY } })

    console.log("Response (streaming):")
    const startTime = Date.now()

    for await (const event of provider.run({
      prompt: "Say hello briefly",
      skipInstall: true, // Already installed
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

    console.log("\n✓ Codex test completed!")

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
