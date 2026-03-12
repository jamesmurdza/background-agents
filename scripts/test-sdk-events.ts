#!/usr/bin/env npx tsx
/**
 * Test to capture SDK events for file write operations from each provider
 */
import { createSandbox, createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const PROMPT = "Write a file called /tmp/test.txt with the content 'Hello World'. Just write the file, nothing else."

async function testProvider(name: string, providerType: "claude" | "codex" | "opencode", apiKey: string, envKey: string) {
  console.log("\n" + "=".repeat(70))
  console.log(`  ${name.toUpperCase()} - SDK Events for Write File`)
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { [envKey]: apiKey },
  })

  await sandbox.create()
  console.log("Sandbox created\n")

  try {
    if (providerType === "codex") {
      console.log("Installing Codex CLI...")
      await sandbox.executeCommand("npm install -g @openai/codex", 120)
      await sandbox.executeCommand(`echo "${apiKey}" | codex login --with-api-key 2>&1`, 30)
      console.log("Codex ready\n")
    }

    const provider = createProvider(providerType, { sandbox })

    console.log("Events received:")
    console.log("-".repeat(50))

    for await (const event of provider.run({
      prompt: PROMPT,
      autoInstall: providerType !== "codex",
    })) {
      // Print each event as JSON for clear inspection
      console.log(JSON.stringify(event, null, 2))
    }

    console.log("-".repeat(50))
    console.log(`✓ ${name} done`)
  } finally {
    await sandbox.destroy()
  }
}

async function main() {
  const provider = process.argv[2] || "all"

  if (provider === "claude" || provider === "all") {
    await testProvider("Claude", "claude", ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY")
  }

  if (provider === "codex" || provider === "all") {
    await testProvider("Codex", "codex", OPENAI_API_KEY, "OPENAI_API_KEY")
  }

  if (provider === "opencode" || provider === "all") {
    await testProvider("OpenCode", "opencode", OPENAI_API_KEY, "OPENAI_API_KEY")
  }

  console.log("\n" + "=".repeat(70))
  console.log("  All tests completed!")
  console.log("=".repeat(70))
}

main().catch(console.error)
