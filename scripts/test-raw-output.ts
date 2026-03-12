#!/usr/bin/env npx tsx
/**
 * Test to capture RAW JSON output from each provider CLI
 */
import { createSandbox } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!

async function testClaudeRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  CLAUDE - Raw JSON Output")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { ANTHROPIC_API_KEY },
  })

  await sandbox.create()
  console.log("Sandbox created, running claude command...\n")

  try {
    // Run claude CLI directly and capture raw output
    const result = await sandbox.executeCommand(
      `claude -p --output-format stream-json --verbose "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
      120
    )
    console.log("RAW OUTPUT:")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function testCodexRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  CODEX - Raw JSON Output")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { OPENAI_API_KEY },
  })

  await sandbox.create()
  console.log("Sandbox created, installing codex...\n")

  try {
    await sandbox.executeCommand("npm install -g @openai/codex", 120)
    await sandbox.executeCommand(`echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`, 30)

    // Run codex CLI with exec --json (correct command)
    const result = await sandbox.executeCommand(
      `codex exec --json --skip-git-repo-check "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
      120
    )
    console.log("RAW OUTPUT:")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function testGeminiRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  GEMINI - Raw JSON Output")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { GOOGLE_API_KEY: GEMINI_API_KEY, GEMINI_API_KEY },
  })

  await sandbox.create()
  console.log("Sandbox created, installing gemini-cli...\n")

  try {
    // Install gemini CLI (google's official)
    const installResult = await sandbox.executeCommand(
      "npm install -g @anthropic-ai/gemini-cli 2>&1 || npm install -g @anthropic-ai/gemini 2>&1 || npm install -g @anthropic-ai/gemini-cli@latest 2>&1",
      120
    )
    console.log("Install attempt 1:", installResult.output.substring(0, 500))

    // Try Google's gemini CLI
    const installResult2 = await sandbox.executeCommand(
      "npm install -g @anthropic-ai/gemini-cli 2>&1 || npm install -g gemini-cli 2>&1",
      120
    )
    console.log("Install attempt 2:", installResult2.output.substring(0, 500))

    // Check what's available
    const helpResult = await sandbox.executeCommand("gemini --help 2>&1 || which gemini || echo 'not found'", 10)
    console.log("Gemini help/path:", helpResult.output)

  } finally {
    await sandbox.destroy()
  }
}

async function testOpenCodeRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  OPENCODE - Raw JSON Output")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { OPENAI_API_KEY },
  })

  await sandbox.create()
  console.log("Sandbox created, installing opencode...\n")

  try {
    // Install opencode - try different methods
    const installResult = await sandbox.executeCommand(
      "curl -fsSL https://opencode.ai/install | bash 2>&1 || echo 'curl install failed'",
      120
    )
    console.log("Install result:", installResult.output.substring(0, 500))

    // Check if opencode is available
    const whichResult = await sandbox.executeCommand("which opencode 2>&1 || echo 'opencode not found'", 10)
    console.log("Which opencode:", whichResult.output)

    // Try to get help
    const helpResult = await sandbox.executeCommand("opencode --help 2>&1 || echo 'no help'", 30)
    console.log("OpenCode help:", helpResult.output.substring(0, 1000))

    // If opencode exists, run it
    if (whichResult.output.includes("/opencode")) {
      const result = await sandbox.executeCommand(
        `opencode --json "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
        120
      )
      console.log("RAW OUTPUT:")
      console.log(result.output)
    }

  } finally {
    await sandbox.destroy()
  }
}

async function main() {
  const provider = process.argv[2] || "all"

  if (provider === "claude" || provider === "all") {
    await testClaudeRaw()
  }
  if (provider === "codex" || provider === "all") {
    await testCodexRaw()
  }
  if (provider === "gemini" || provider === "all") {
    await testGeminiRaw()
  }
  if (provider === "opencode" || provider === "all") {
    await testOpenCodeRaw()
  }
}

main().catch(console.error)
