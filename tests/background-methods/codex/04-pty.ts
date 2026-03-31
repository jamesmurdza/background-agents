/**
 * Test: Run Codex using PTY (Pseudo Terminal)
 *
 * This method uses PTY sessions which provide interactive terminal access.
 *
 * Features tested:
 * - Async launch (sendInput returns immediately)
 * - Check if still running (via PTY session status + process check)
 * - Kill process early (via PTY kill or Ctrl+C)
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
    envVars: { TEST_OPENAI_API_KEY: cleanEnv(process.env.TEST_OPENAI_API_KEY!) },
  })
  console.log(`   Sandbox created: ${sandbox.id}\n`)

  // Helper functions
  const isRunning = async (pid: number): Promise<boolean> => {
    const result = await sandbox.process.executeCommand(`kill -0 ${pid} 2>/dev/null && echo running || echo stopped`)
    return result.result?.trim() === "running"
  }

  const killProcess = async (pid: number): Promise<boolean> => {
    // Kill the process group (negative PID) to get all children
    await sandbox.process.executeCommand(`kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`)
    await new Promise((r) => setTimeout(r, 500))
    if (await isRunning(pid)) {
      await sandbox.process.executeCommand(`kill -9 -${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`)
    }
    // Also try pkill for any codex processes
    await sandbox.process.executeCommand(`pkill -9 -f codex 2>/dev/null || true`)
    return !(await isRunning(pid))
  }

  let ptyHandle: Awaited<ReturnType<typeof sandbox.process.createPty>> | null = null
  const ptyId = `codex-pty-${Date.now()}`

  try {
    // 2. Install codex CLI
    console.log("2. Installing codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("   Codex installed.\n")

    // 3. Create PTY session
    console.log("3. Creating PTY session...")
    const outputFile = "/tmp/codex-pty-output.jsonl"
    const pidFile = "/tmp/codex-pty.pid"

    let collectedOutput = ""
    ptyHandle = await sandbox.process.createPty({
      id: ptyId,
      cwd: "/home/daytona",
      envs: {
        TERM: "xterm-256color",
        TEST_OPENAI_API_KEY: cleanEnv(process.env.TEST_OPENAI_API_KEY!),
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

    // 4. Start codex in PTY (capture PID)
    console.log("4. Starting Codex in PTY...")
    const prompt = "Write a hello world Python script and run it"
    // Run codex in background within PTY, capture PID
    const command = `codex exec --json --skip-git-repo-check --yolo "${prompt}" 2>&1 | tee ${outputFile} & echo $! > ${pidFile}; wait; echo "DONE_MARKER" >> ${outputFile}\n`

    const startTime = Date.now()
    await ptyHandle.sendInput(command)
    const launchTime = Date.now() - startTime

    console.log(`   Command sent in ${launchTime}ms\n`)

    // Wait for PID file
    await new Promise((r) => setTimeout(r, 1000))
    const pidResult = await sandbox.process.executeCommand(`cat ${pidFile} 2>/dev/null || echo 0`)
    const pid = parseInt(pidResult.result?.trim() || "0")
    console.log(`   Codex PID: ${pid}\n`)

    // 5. Check PTY session status
    console.log("5. Checking PTY session status...")
    const sessions = await sandbox.process.listPtySessions()
    const ourSession = sessions.find((s) => s.id === ptyId)
    console.log(`   Session found: ${ourSession ? "yes" : "no"}`)
    console.log(`   Session active: ${ourSession?.active}`)
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 6. Disconnect from PTY
    console.log("6. Disconnecting from PTY...")
    await ptyHandle.disconnect()
    ptyHandle = null
    console.log("   Disconnected.\n")

    // 7. Wait
    console.log("7. Waiting 2 seconds...\n")
    await new Promise((r) => setTimeout(r, 2000))

    // 8. Check if still running
    console.log("8. Checking if process is still running...")
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 9. Reconnect and poll
    console.log("9. Reconnecting to PTY...")
    let reconnectOutput = ""
    const reconnectHandle = await sandbox.process.connectPty(ptyId, {
      onData: (data: Uint8Array) => {
        reconnectOutput += new TextDecoder().decode(data)
      },
    })
    await reconnectHandle.waitForConnection()
    console.log("   Reconnected.\n")

    // 10. Poll for results
    console.log("10. Polling for results (will kill after 5 polls)...")
    let cursor = 0
    let pollCount = 0
    while (pollCount < 5) {
      pollCount++
      const pollResult = await sandbox.process.executeCommand(`cat ${outputFile} 2>/dev/null || true`)
      const content = pollResult.result || ""

      const newContent = content.slice(cursor)
      if (newContent) {
        const cleaned = newContent.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
        process.stdout.write(cleaned)
        cursor = content.length
      }

      if (content.includes("DONE_MARKER")) {
        console.log("\n   Process completed naturally!")
        break
      }

      console.log(`   [Poll ${pollCount}/5] Still running: ${await isRunning(pid)}`)
      await new Promise((r) => setTimeout(r, 1000))
    }

    // 11. Kill process if still running
    console.log("\n11. Attempting to kill process...")
    if (pid > 0 && (await isRunning(pid))) {
      // Option 1: Send Ctrl+C to PTY
      console.log("   Sending Ctrl+C to PTY...")
      await reconnectHandle.sendInput("\x03") // Ctrl+C
      await new Promise((r) => setTimeout(r, 500))

      if (await isRunning(pid)) {
        // Option 2: Kill via shell command
        console.log("   Ctrl+C didn't work, using kill command...")
        const killed = await killProcess(pid)
        console.log(`   Kill successful: ${killed}`)
      } else {
        console.log("   Ctrl+C worked!")
      }
      console.log(`   Process running after kill: ${await isRunning(pid)}`)
    } else {
      console.log("   Process already exited.")
    }

    // 12. Kill PTY session
    console.log("\n12. Killing PTY session...")
    await reconnectHandle.disconnect()
    await sandbox.process.killPtySession(ptyId)
    console.log("   PTY killed.")

    console.log("\n=== PTY Method Complete ===")
    console.log(`Launch time: ${launchTime}ms`)
    console.log("Features: ✅ Async launch, ✅ Check running (PTY + PID), ✅ Kill (Ctrl+C or kill)")
  } finally {
    // Cleanup
    if (ptyHandle) {
      try {
        await ptyHandle.disconnect()
      } catch {}
    }
    try {
      await sandbox.process.killPtySession(ptyId)
    } catch {}
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
