#!/usr/bin/env npx tsx
/**
 * Test to capture RAW JSON output from each provider CLI
 */
import { Daytona } from "@daytonaio/sdk"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!

function out(r: { result?: string }): string {
  return r.result ?? ""
}

async function testClaudeRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  CLAUDE - Raw JSON Output")
  console.log("=".repeat(70))

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY },
  })
  console.log("Sandbox created, running claude command...\n")

  try {
    const result = await sandbox.process.executeCommand(
      `claude -p --output-format stream-json --verbose "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
      undefined,
      undefined,
      120
    )
    console.log("RAW OUTPUT:")
    console.log(out(result))
  } finally {
    await sandbox.delete()
  }
}

async function testCodexRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  CODEX - Raw JSON Output")
  console.log("=".repeat(70))

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { OPENAI_API_KEY },
  })
  console.log("Sandbox created, installing codex...\n")

  try {
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    await sandbox.process.executeCommand(`echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`, undefined, undefined, 30)

    const result = await sandbox.process.executeCommand(
      `codex exec --json --skip-git-repo-check "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
      undefined,
      undefined,
      120
    )
    console.log("RAW OUTPUT:")
    console.log(out(result))
  } finally {
    await sandbox.delete()
  }
}

async function testGeminiRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  GEMINI - Raw JSON Output")
  console.log("=".repeat(70))

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { GEMINI_API_KEY },
  })
  console.log("Sandbox created, installing gemini-cli...\n")

  try {
    const installResult = await sandbox.process.executeCommand(
      "npm install -g @anthropic-ai/gemini-cli 2>&1 || npm install -g @anthropic-ai/gemini 2>&1 || npm install -g @anthropic-ai/gemini-cli@latest 2>&1",
      undefined,
      undefined,
      120
    )
    console.log("Install attempt 1:", out(installResult).substring(0, 500))

    const installResult2 = await sandbox.process.executeCommand(
      "npm install -g @anthropic-ai/gemini-cli 2>&1 || npm install -g gemini-cli 2>&1",
      undefined,
      undefined,
      120
    )
    console.log("Install attempt 2:", out(installResult2).substring(0, 500))

    const helpResult = await sandbox.process.executeCommand("gemini --help 2>&1 || which gemini || echo 'not found'", undefined, undefined, 10)
    console.log("Gemini help/path:", out(helpResult))
  } finally {
    await sandbox.delete()
  }
}

async function testOpenCodeRaw() {
  console.log("\n" + "=".repeat(70))
  console.log("  OPENCODE - Raw JSON Output")
  console.log("=".repeat(70))

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { OPENAI_API_KEY },
  })
  console.log("Sandbox created, installing opencode...\n")

  try {
    const installResult = await sandbox.process.executeCommand(
      "curl -fsSL https://opencode.ai/install | bash 2>&1 || echo 'curl install failed'",
      undefined,
      undefined,
      120
    )
    console.log("Install result:", out(installResult).substring(0, 500))

    const whichResult = await sandbox.process.executeCommand("which opencode 2>&1 || echo 'opencode not found'", undefined, undefined, 10)
    console.log("Which opencode:", out(whichResult))

    const helpResult = await sandbox.process.executeCommand("opencode --help 2>&1 || echo 'no help'", undefined, undefined, 30)
    console.log("OpenCode help:", out(helpResult).substring(0, 1000))

    if (out(whichResult).includes("/opencode")) {
      const result = await sandbox.process.executeCommand(
        `opencode --json "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else." 2>&1`,
        undefined,
        undefined,
        120
      )
      console.log("RAW OUTPUT:")
      console.log(out(result))
    }
  } finally {
    await sandbox.delete()
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
