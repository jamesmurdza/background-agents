#!/usr/bin/env npx tsx
/**
 * Test script to capture RAW tool call output from each provider's CLI
 */
import { createSandbox } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

const PROMPT = "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else."

async function testClaude() {
  console.log("\n" + "=".repeat(70))
  console.log("  CLAUDE RAW OUTPUT")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { ANTHROPIC_API_KEY: ANTHROPIC_API_KEY! },
  })
  await sandbox.create()

  try {
    // Install claude
    console.log("Installing Claude CLI...")
    await sandbox.executeCommand("npm install -g @anthropic-ai/claude-code", 120)

    // Run claude and capture raw output (with dangerously skip permissions)
    console.log("Running Claude...")
    const result = await sandbox.executeCommand(
      `claude -p --output-format stream-json --verbose --dangerously-skip-permissions "${PROMPT}"`,
      120
    )
    console.log("\n--- RAW OUTPUT ---")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function testCodex() {
  console.log("\n" + "=".repeat(70))
  console.log("  CODEX RAW OUTPUT")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { OPENAI_API_KEY: OPENAI_API_KEY! },
  })
  await sandbox.create()

  try {
    // Install codex
    console.log("Installing Codex CLI...")
    await sandbox.executeCommand("npm install -g @openai/codex", 120)
    await sandbox.executeCommand(`echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`, 30)

    // Run codex with full-auto mode
    console.log("Running Codex...")
    const result = await sandbox.executeCommand(
      `codex exec --json --skip-git-repo-check --full-auto "${PROMPT}"`,
      120
    )
    console.log("\n--- RAW OUTPUT ---")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function testGemini() {
  console.log("\n" + "=".repeat(70))
  console.log("  GEMINI RAW OUTPUT")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { GOOGLE_API_KEY: GEMINI_API_KEY! },
  })
  await sandbox.create()

  try {
    // Install gemini and setup
    console.log("Installing Gemini CLI...")
    await sandbox.executeCommand("npm install -g @google/gemini-cli", 120)
    await sandbox.executeCommand("mkdir -p /home/daytona/.gemini", 10)

    // Run gemini with correct flags
    console.log("Running Gemini...")
    const result = await sandbox.executeCommand(
      `gemini -p "${PROMPT}" --output-format stream-json --yolo 2>&1`,
      120
    )
    console.log("\n--- RAW OUTPUT ---")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function testOpenCode() {
  console.log("\n" + "=".repeat(70))
  console.log("  OPENCODE RAW OUTPUT")
  console.log("=".repeat(70))

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { OPENAI_API_KEY: OPENAI_API_KEY! },
  })
  await sandbox.create()

  try {
    // Install opencode
    console.log("Installing OpenCode...")
    await sandbox.executeCommand("npm install -g opencode@latest", 120)

    const whichResult = await sandbox.executeCommand("which opencode || echo 'not found'", 10)
    console.log("OpenCode location:", whichResult.output.trim())

    // Run opencode with run subcommand
    console.log("Running OpenCode...")
    const result = await sandbox.executeCommand(
      `opencode run --print-logs "${PROMPT}" 2>&1`,
      120
    )
    console.log("\n--- RAW OUTPUT ---")
    console.log(result.output)
  } finally {
    await sandbox.destroy()
  }
}

async function main() {
  console.log("============================================================")
  console.log("  Capturing RAW Tool Call Output from CLI")
  console.log("============================================================")

  if (ANTHROPIC_API_KEY) {
    await testClaude()
  }

  if (OPENAI_API_KEY) {
    await testCodex()
  }

  if (GEMINI_API_KEY) {
    await testGemini()
  }

  if (OPENAI_API_KEY) {
    await testOpenCode()
  }

  console.log("\n" + "=".repeat(70))
  console.log("  Done!")
  console.log("=".repeat(70))
}

main().catch(console.error)
