/**
 * Test: Run Codex using executeCommand
 *
 * This method uses the standard executeCommand API with shell backgrounding.
 *
 * Features tested:
 * - Async launch (returns immediately with PID)
 * - Check if still running (via kill -0 or ps)
 * - Kill process early (via kill command)
 */

import { Daytona } from "@daytonaio/sdk"

// Clean API key (remove hidden chars like \r)
const cleanEnv = (val: string) => val.replace(/[\r\n\s]/g, "")

async function main() {
  console.log("=== executeCommand Background Method ===\n")

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

  try {
    // 2. Install codex CLI
    console.log("2. Installing codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("   Codex installed.\n")

    // 3. Start codex with nohup (returns immediately)
    console.log("3. Starting Codex with nohup...")
    const outputFile = "/tmp/codex-output.jsonl"
    const prompt = "Write a hello world Python script and run it"
    const nohupCommand = `nohup sh -c 'codex exec --json --skip-git-repo-check --yolo "${prompt}" >> ${outputFile} 2>&1; echo 1 > ${outputFile}.done' > /dev/null 2>&1 & echo $!`

    const startTime = Date.now()
    const result = await sandbox.process.executeCommand(
      nohupCommand,
      undefined,
      { TEST_OPENAI_API_KEY: cleanEnv(process.env.TEST_OPENAI_API_KEY!) },
      120
    )
    const launchTime = Date.now() - startTime
    const pid = parseInt(result.result?.trim() || "0")

    console.log(`   Started with PID: ${pid}`)
    console.log(`   Launch returned in ${launchTime}ms\n`)

    // 4. Check if process is running
    console.log("4. Checking if process is running...")
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 5. Wait a bit
    console.log("5. Waiting 2 seconds...\n")
    await new Promise((r) => setTimeout(r, 2000))

    // 6. Check again
    console.log("6. Checking if process is still running...")
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 7. Poll for results
    console.log("7. Polling for results (will kill after 5 polls)...")
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

    // 8. Kill process if still running
    console.log("\n8. Attempting to kill process...")
    if (await isRunning(pid)) {
      const killed = await killProcess(pid)
      console.log(`   Kill successful: ${killed}`)
      console.log(`   Process running after kill: ${await isRunning(pid)}`)
    } else {
      console.log("   Process already exited.")
    }

    console.log("\n=== executeCommand Method Complete ===")
    console.log(`Launch time: ${launchTime}ms`)
    console.log("Features: ✅ Async launch, ✅ Check running, ✅ Kill process")
  } finally {
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
