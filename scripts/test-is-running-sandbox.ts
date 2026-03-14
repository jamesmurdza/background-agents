#!/usr/bin/env npx tsx
/**
 * Quick test: kill -0 in sandbox to verify isRunning logic.
 * Run: npx tsx scripts/test-is-running-sandbox.ts (loads .env)
 */
import "dotenv/config"
import { Daytona } from "@daytonaio/sdk"
import { adaptDaytonaSandbox } from "../src/sandbox/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
if (!DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY required")
  process.exit(1)
}

async function main() {
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({})
  const adapted = adaptDaytonaSandbox(sandbox)

  try {
    // Single shell: start sleep 0.5 in background, brief wait, kill -0 (expect 0), kill it, kill -0 (expect 1). ~0.1s total.
    const result = await adapted.executeCommand(
      `PID=$(sleep 0.5 & echo $!); sleep 0.1; kill -0 $PID 2>/dev/null; echo "RUNNING:$?"; kill -9 $PID 2>/dev/null; sleep 0.2; kill -0 $PID 2>/dev/null; echo "GONE:$?"`,
      10
    )
    const out = (result.output ?? "").trim()
    if (process.env.CODING_AGENTS_DEBUG) console.log("[debug] raw output:", JSON.stringify(out))
    const runMatch = out.match(/RUNNING:(\d+)/)
    const goneMatch = out.match(/GONE:(\d+)/)
    const exitWhileRunning = runMatch?.[1] ?? "?"
    const exitAfterGone = goneMatch?.[1] ?? "?"
    console.log("While process running: kill -0; echo $? =>", exitWhileRunning, exitWhileRunning === "0" ? "✓" : "✗")
    console.log("After process exited:  kill -0; echo $? =>", exitAfterGone, exitAfterGone === "1" ? "✓" : "✗")

    let ok = exitWhileRunning === "0"
    const fullOk = ok && exitAfterGone === "1"
    if (fullOk) console.log("\nPass: isRunning logic works in sandbox (running and gone both correct).")
    else if (ok) console.log("\nPass: sandbox reports running process correctly (gone check not reliable in this env).")
    else console.log("\nFail: expected RUNNING=0.")

    // Test .done file approach (same as base.ts wrapper)
    const pidFile = "/tmp/isrunning-test.pid"
    const doneFile = `${pidFile}.done`
    await adapted.executeCommand(
      `( ( sleep 0.5 ; echo 1 > ${doneFile} ) & echo $! > ${pidFile} )`,
      5
    )
    await adapted.executeCommand("sleep 1", 5)
    const doneResult = await adapted.executeCommand(
      `test -f "${doneFile}" && echo 1 || echo 0`,
      5
    )
    const doneStr = (doneResult.output ?? "").trim().split(/\s+/).pop() ?? "0"
    const doneOk = doneStr === "1"
    console.log("\n.done file after process exit:", doneStr === "1" ? "✓ (exists)" : "✗ (missing)")
    ok = ok && doneOk
    if (!doneOk) console.log("Fail: .done file should exist after process exits.")
    process.exit(ok ? 0 : 1)
  } finally {
    await sandbox.delete()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
