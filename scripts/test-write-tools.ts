#!/usr/bin/env npx tsx
/**
 * Test script to capture what "write file" tool calls look like for each provider
 */
import { Daytona } from "@daytonaio/sdk"
import { createProvider } from "../src/index.js"
import type { Sandbox } from "@daytonaio/sdk"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

async function testProvider(
  name: string,
  providerType: "claude" | "codex" | "gemini" | "opencode",
  sandbox: Sandbox,
  env: Record<string, string>,
  extraSetup?: () => Promise<void>
) {
  console.log("\n" + "=".repeat(70))
  console.log(`  ${name} - Write File Tool Call`)
  console.log("=".repeat(70))

  try {
    if (extraSetup) await extraSetup()

    const provider = createProvider(providerType, { sandbox, env })

    let toolOutput = ""
    let currentToolName = ""

    for await (const event of provider.run({
      prompt: "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else.",
      skipInstall: providerType === "codex", // codex already installed in this script
    })) {
      switch (event.type) {
        case "session":
          console.log(`[SESSION] ${event.id}`)
          break
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          currentToolName = event.name
          console.log(`\n>>> TOOL_START: "${event.name}"`)
          toolOutput = ""
          break
        case "tool_delta":
          toolOutput += event.text
          break
        case "tool_end":
          console.log(`>>> TOOL_END`)
          console.log(`>>> TOOL NAME: "${currentToolName}"`)
          console.log(`>>> TOOL CONTENT:`)
          console.log(toolOutput)
          console.log(`>>> END TOOL CONTENT`)
          break
        case "end":
          console.log(`\n[END]`)
          break
      }
    }

    console.log(`\n✓ ${name} test completed!`)
  } catch (error) {
    console.error(`\n✗ ${name} error:`, error)
  }
}

async function main() {
  console.log("============================================================")
  console.log("  Testing Write File Tool Calls for All Providers")
  console.log("============================================================")

  if (ANTHROPIC_API_KEY && DAYTONA_API_KEY) {
    console.log("\n--- Creating sandbox for Claude ---")
    const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
    const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY } })
    try {
      await testProvider("Claude", "claude", sandbox, { ANTHROPIC_API_KEY })
    } finally {
      await sandbox.delete()
    }
  } else {
    console.log("\nSkipping Claude (no ANTHROPIC_API_KEY)")
  }

  if (OPENAI_API_KEY && DAYTONA_API_KEY) {
    console.log("\n--- Creating sandbox for Codex ---")
    const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
    const sandbox = await daytona.create({ envVars: { OPENAI_API_KEY } })
    console.log("Installing Codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("Logging in...")
    await sandbox.process.executeCommand(`echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`, undefined, undefined, 30)
    try {
      await testProvider("Codex", "codex", sandbox, { OPENAI_API_KEY })
    } finally {
      await sandbox.delete()
    }
  } else {
    console.log("\nSkipping Codex (no OPENAI_API_KEY)")
  }

  if (GEMINI_API_KEY && DAYTONA_API_KEY) {
    console.log("\n--- Creating sandbox for Gemini ---")
    const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
    const sandbox = await daytona.create({ envVars: { GOOGLE_API_KEY: GEMINI_API_KEY } })
    try {
      await testProvider("Gemini", "gemini", sandbox, { GOOGLE_API_KEY: GEMINI_API_KEY })
    } finally {
      await sandbox.delete()
    }
  } else {
    console.log("\nSkipping Gemini (no GEMINI_API_KEY)")
  }

  if (OPENAI_API_KEY && DAYTONA_API_KEY) {
    console.log("\n--- Creating sandbox for OpenCode ---")
    const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
    const sandbox = await daytona.create({ envVars: { OPENAI_API_KEY } })
    try {
      await testProvider("OpenCode", "opencode", sandbox, { OPENAI_API_KEY })
    } finally {
      await sandbox.delete()
    }
  } else {
    console.log("\nSkipping OpenCode (no OPENAI_API_KEY)")
  }

  console.log("\n" + "=".repeat(70))
  console.log("  All tests completed!")
  console.log("=".repeat(70))
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
