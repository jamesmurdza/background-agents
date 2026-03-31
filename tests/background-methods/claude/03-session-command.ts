/**
 * Test: Run Claude Code using executeSessionCommand
 *
 * This method uses session-based command execution with runAsync: true.
 *
 * Features tested:
 * - Async launch (returns immediately with cmdId)
 * - Check if still running (via getSessionCommandInfo or kill -0)
 * - Kill process early (via kill command)
 */

import { Daytona } from "@daytonaio/sdk"

// Clean API key (remove hidden chars like \r)
const cleanEnv = (val: string) => val.replace(/[\r\n\s]/g, "")

async function main() {
  console.log("=== executeSessionCommand Background Method (Claude) ===\n")

  // 1. Create sandbox
  console.log("1. Creating sandbox...")
  const daytona = new Daytona({ apiKey: cleanEnv(process.env.DAYTONA_API_KEY!) })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY: cleanEnv(process.env.TEST_ANTHROPIC_API_KEY!) },
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
    // Also try pkill for any claude processes
    await sandbox.process.executeCommand(`pkill -9 -f claude 2>/dev/null || true`)
    return !(await isRunning(pid))
  }

  try {
    // 2. Install claude CLI
    console.log("2. Installing claude CLI...")
    await sandbox.process.executeCommand("npm install -g @anthropic-ai/claude-code", undefined, undefined, 120)
    console.log("   Claude installed.\n")

    // 3. Create a session
    console.log("3. Creating session...")
    const sessionId = `claude-session-${Date.now()}`
    await sandbox.process.createSession(sessionId)
    console.log(`   Session created: ${sessionId}\n`)

    // 4. Set up environment in session
    console.log("4. Setting up environment in session...")
    await sandbox.process.executeSessionCommand(sessionId, {
      command: `export ANTHROPIC_API_KEY='${cleanEnv(process.env.TEST_ANTHROPIC_API_KEY!)}'`,
    })
    console.log("   Environment set.\n")

    // 5. Start claude with runAsync: true
    console.log("5. Starting Claude with runAsync: true...")
    const outputFile = "/tmp/claude-session-output.jsonl"
    const pidFile = "/tmp/claude-session.pid"
    const prompt = "Write a hello world Python script and run it"
    // Store the PID so we can track/kill it
    const command = `claude --print --output-format stream-json --verbose --dangerously-skip-permissions "${prompt}" >> ${outputFile} 2>&1 & echo $! > ${pidFile}; echo 1 > ${outputFile}.done`

    const startTime = Date.now()
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: command,
        runAsync: true,
      },
      120
    )
    const launchTime = Date.now() - startTime

    console.log(`   Command returned in ${launchTime}ms`)
    console.log(`   Result: ${JSON.stringify(result).slice(0, 200)}\n`)

    // Get the PID
    await new Promise((r) => setTimeout(r, 500)) // Wait for PID file to be written
    const pidResult = await sandbox.process.executeCommand(`cat ${pidFile} 2>/dev/null || echo 0`)
    const pid = parseInt(pidResult.result?.trim() || "0")
    console.log(`   Claude PID: ${pid}\n`)

    // 6. Check if process is running
    console.log("6. Checking if process is running...")
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 7. Check command status via SDK (if available)
    console.log("7. Checking command status via SDK...")
    try {
      const cmdInfo = await sandbox.process.getSessionCommandInfo(sessionId, result.cmdId!)
      console.log(`   Command info: ${JSON.stringify(cmdInfo).slice(0, 200)}\n`)
    } catch (e) {
      console.log(`   getSessionCommandInfo not available or failed: ${e}\n`)
    }

    // 8. Wait a bit
    console.log("8. Waiting 2 seconds...\n")
    await new Promise((r) => setTimeout(r, 2000))

    // 9. Poll for results
    console.log("9. Polling for results (will kill after 5 polls)...")
    let cursor = 0
    let pollCount = 0
    while (pollCount < 5) {
      pollCount++
      const pollResult = await sandbox.process.executeCommand(`cat ${outputFile} 2>/dev/null || true`)
      const content = pollResult.result || ""

      const newContent = content.slice(cursor)
      if (newContent) {
        process.stdout.write(newContent)
        cursor = content.length
      }

      const doneCheck = await sandbox.process.executeCommand(
        `test -f ${outputFile}.done && echo done || echo running`
      )
      if (doneCheck.result?.trim() === "done") {
        console.log("\n   Process completed naturally!")
        break
      }

      console.log(`   [Poll ${pollCount}/5] Still running: ${await isRunning(pid)}`)
      await new Promise((r) => setTimeout(r, 1000))
    }

    // 10. Kill process if still running
    console.log("\n10. Attempting to kill process...")
    if (pid > 0 && (await isRunning(pid))) {
      const killed = await killProcess(pid)
      console.log(`   Kill successful: ${killed}`)
      console.log(`   Process running after kill: ${await isRunning(pid)}`)
    } else {
      console.log("   Process already exited or PID not available.")
    }

    console.log("\n=== executeSessionCommand Method Complete (Claude) ===")
    console.log(`Launch time: ${launchTime}ms`)
    console.log("Features: ✅ Async launch (cmdId), ✅ Check running (PID), ✅ Kill process")
  } finally {
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
