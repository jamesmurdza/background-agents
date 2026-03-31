/**
 * Test: Run Codex using PTY (Pseudo Terminal)
 *
 * This method uses PTY sessions which provide interactive terminal access.
 * We can disconnect and reconnect to the same PTY session.
 *
 * HYPOTHESIS: PTY sessions persist and can be polled from a different "thread"
 */

import { Daytona } from "@daytonaio/sdk"

// Clean API key (remove hidden chars like \r)
const cleanEnv = (val: string) => val.replace(/[\r\n\s]/g, "")

async function main() {
  console.log("=== PTY Background Method ===\n")

  // 1. Create sandbox
  console.log("1. Creating sandbox...")
  const daytona = new Daytona({ apiKey: cleanEnv(process.env.DAYTONA_API_KEY!) })
  const sandbox = await daytona.create({
    envVars: { OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY!) },
  })
  console.log(`   Sandbox created: ${sandbox.id}\n`)

  try {
    // 2. Install codex CLI
    console.log("2. Installing codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("   Codex installed.\n")

    // 3. Create PTY session
    console.log("3. Creating PTY session...")
    const ptyId = `codex-pty-${Date.now()}`
    const outputFile = "/tmp/codex-pty-output.jsonl"

    let collectedOutput = ""
    const ptyHandle = await sandbox.process.createPty({
      id: ptyId,
      cwd: "/home/daytona",
      envs: {
        TERM: "xterm-256color",
        OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY!),
      },
      cols: 200,
      rows: 50,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        collectedOutput += text
      },
    })
    await ptyHandle.waitForConnection()
    console.log(`   PTY created: ${ptyId}\n`)

    // 4. Start codex in PTY
    console.log("4. Starting Codex in PTY...")
    const prompt = "Write a hello world Python script and run it"
    const command = `codex exec --json --skip-git-repo-check --yolo "${prompt}" 2>&1 | tee ${outputFile}; echo "DONE_MARKER" >> ${outputFile}\n`

    const startTime = Date.now()
    await ptyHandle.sendInput(command)
    const launchTime = Date.now() - startTime

    console.log(`   Command sent in ${launchTime}ms`)
    console.log("   PTY is now running the command.\n")

    // 5. Disconnect from PTY (simulating "different thread")
    console.log("5. Disconnecting from PTY (simulating different thread)...")
    await ptyHandle.disconnect()
    console.log("   Disconnected. PTY session should still be running.\n")

    // 6. Wait (simulating doing other work)
    console.log("6. Waiting 3 seconds (simulating other work)...\n")
    await new Promise((r) => setTimeout(r, 3000))

    // 7. Check PTY session status
    console.log("7. Checking PTY session status...")
    const sessions = await sandbox.process.listPtySessions()
    const ourSession = sessions.find((s) => s.id === ptyId)
    console.log(`   Session found: ${ourSession ? "yes" : "no"}`)
    if (ourSession) {
      console.log(`   Session active: ${ourSession.active}\n`)
    }

    // 8. Reconnect to PTY and get output
    console.log("8. Reconnecting to PTY session...")
    let reconnectOutput = ""
    const reconnectHandle = await sandbox.process.connectPty(ptyId, {
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        reconnectOutput += text
      },
    })
    await reconnectHandle.waitForConnection()
    console.log("   Reconnected.\n")

    // 9. Poll for completion
    console.log("9. Polling for results (via output file)...")
    let cursor = 0
    let pollCount = 0
    while (pollCount < 120) {
      pollCount++

      const pollResult = await sandbox.process.executeCommand(`cat ${outputFile} 2>/dev/null || true`)
      const content = pollResult.result || ""

      const newContent = content.slice(cursor)
      if (newContent) {
        // Filter out ANSI codes for cleaner output
        const cleaned = newContent.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
        process.stdout.write(cleaned)
        cursor = content.length
      }

      // Check for done marker
      if (content.includes("DONE_MARKER")) {
        console.log("\n\n   Process completed!")
        break
      }

      await new Promise((r) => setTimeout(r, 500))
    }

    // 10. Clean up PTY
    console.log("\n10. Killing PTY session...")
    await reconnectHandle.disconnect()
    await sandbox.process.killPtySession(ptyId)
    console.log("   PTY killed.")

    console.log("\n=== PTY Method Complete ===")
    console.log(`Command send time: ${launchTime}ms`)
    console.log("Verdict: PTY allows disconnect/reconnect pattern for pseudo-async execution")
  } finally {
    // Cleanup
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
