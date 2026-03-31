/**
 * Test: Run Claude Code in background using SSH
 *
 * This method uses SSH to launch the process with nohup, which returns immediately.
 * The process runs detached from the SSH session, and we poll a file for results.
 *
 * Features tested:
 * - Async launch (returns immediately with PID)
 * - Check if still running (via kill -0 or ps)
 * - Kill process early (via kill command)
 */

import { Daytona } from "@daytonaio/sdk"
import { Client } from "ssh2"

const SSH_HOST = "ssh.app.daytona.io"
const SSH_PORT = 22

// Clean API key (remove hidden chars like \r)
const cleanEnv = (val: string) => val.replace(/[\r\n\s]/g, "")

async function main() {
  console.log("=== SSH Background Method (Claude) ===\n")

  // 1. Create sandbox
  console.log("1. Creating sandbox...")
  const daytona = new Daytona({ apiKey: cleanEnv(process.env.DAYTONA_API_KEY!) })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY: cleanEnv(process.env.TEST_ANTHROPIC_API_KEY!) },
  })
  console.log(`   Sandbox created: ${sandbox.id}\n`)

  try {
    // 2. Install claude CLI
    console.log("2. Installing claude CLI...")
    await sandbox.process.executeCommand("npm install -g @anthropic-ai/claude-code", undefined, undefined, 120)
    console.log("   Claude installed.\n")

    // 3. Get SSH access for background execution
    console.log("3. Establishing SSH connection...")
    const { token } = await sandbox.createSshAccess(60)
    const ssh = new Client()
    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", resolve)
      ssh.on("error", reject)
      ssh.connect({ host: SSH_HOST, port: SSH_PORT, username: token })
    })
    console.log("   SSH connected.\n")

    // 4. Start claude in background via SSH (returns immediately)
    console.log("4. Starting Claude in background...")
    const outputFile = "/tmp/claude-output.jsonl"
    const prompt = "Write a hello world Python script and run it"
    const apiKey = cleanEnv(process.env.TEST_ANTHROPIC_API_KEY!).replace(/'/g, "'\\''")
    const command = `ANTHROPIC_API_KEY='${apiKey}' claude --print --output-format stream-json --verbose --dangerously-skip-permissions "${prompt}"`
    const safeCmd = command.replace(/'/g, "'\\''")
    const wrapper = `nohup sh -c '${safeCmd} >> ${outputFile} 2>&1; echo 1 > ${outputFile}.done' > /dev/null 2>&1 & echo $!`

    const startTime = Date.now()
    const pid = await new Promise<number>((resolve, reject) => {
      ssh.exec(wrapper, (err, stream) => {
        if (err) return reject(err)
        let output = ""
        stream.on("data", (data: Buffer) => (output += data.toString()))
        stream.on("close", () => resolve(parseInt(output.trim())))
      })
    })
    const launchTime = Date.now() - startTime
    console.log(`   Started with PID: ${pid}`)
    console.log(`   Launch returned in ${launchTime}ms\n`)

    // 5. Check if process is running
    console.log("5. Checking if process is running...")
    const isRunning = async (pid: number): Promise<boolean> => {
      const result = await sandbox.process.executeCommand(`kill -0 ${pid} 2>/dev/null && echo running || echo stopped`)
      return result.result?.trim() === "running"
    }
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 6. Disconnect SSH and wait
    console.log("6. Simulating disconnect (closing SSH)...")
    ssh.end()
    console.log("   SSH disconnected.\n")

    console.log("7. Waiting 2 seconds...\n")
    await new Promise((r) => setTimeout(r, 2000))

    // 8. Check if still running (without SSH)
    console.log("8. Checking if process is still running...")
    console.log(`   Process running: ${await isRunning(pid)}\n`)

    // 9. Poll for a bit
    console.log("9. Polling for results (will kill after 5 polls)...")
    let cursor = 0
    let pollCount = 0
    while (pollCount < 5) {
      pollCount++
      const result = await sandbox.process.executeCommand(`cat ${outputFile} 2>/dev/null || true`)
      const content = result.result || ""

      const newContent = content.slice(cursor)
      if (newContent) {
        process.stdout.write(newContent)
        cursor = content.length
      }

      // Check if done naturally
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

    // 10. Kill the process early if still running
    console.log("\n10. Attempting to kill process...")
    const killProcess = async (pid: number): Promise<boolean> => {
      // Kill the process group (negative PID) to get all children
      await sandbox.process.executeCommand(`kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`)
      await new Promise((r) => setTimeout(r, 500))
      const stillRunning = await isRunning(pid)
      if (stillRunning) {
        await sandbox.process.executeCommand(`kill -9 -${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`)
      }
      // Also try pkill for any claude processes
      await sandbox.process.executeCommand(`pkill -9 -f claude 2>/dev/null || true`)
      return !(await isRunning(pid))
    }

    if (await isRunning(pid)) {
      const killed = await killProcess(pid)
      console.log(`   Kill successful: ${killed}`)
      console.log(`   Process running after kill: ${await isRunning(pid)}`)
    } else {
      console.log("   Process already exited.")
    }

    console.log("\n=== SSH Method Complete (Claude) ===")
    console.log(`Launch time: ${launchTime}ms`)
    console.log("Features: ✅ Async launch, ✅ Check running, ✅ Kill process")
  } finally {
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
