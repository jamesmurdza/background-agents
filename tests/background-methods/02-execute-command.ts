/**
 * Test: Run Codex using executeCommand
 *
 * This method uses the standard executeCommand API.
 * We test if it can run async by using shell backgrounding (&).
 *
 * HYPOTHESIS: executeCommand blocks until completion, even with &
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
    envVars: { OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY!) },
  })
  console.log(`   Sandbox created: ${sandbox.id}\n`)

  try {
    // 2. Install codex CLI
    console.log("2. Installing codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)
    console.log("   Codex installed.\n")

    // 3. Try to start codex in background using shell &
    console.log("3. Attempting to start Codex with shell backgrounding...")
    const outputFile = "/tmp/codex-output.jsonl"
    const prompt = "Write a hello world Python script and run it"
    const command = `codex exec --json --skip-git-repo-check --yolo "${prompt}" >> ${outputFile} 2>&1 & echo $!`

    const startTime = Date.now()
    const result = await sandbox.process.executeCommand(
      command,
      undefined,
      { OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY!) },
      120 // 2 minute timeout
    )
    const launchTime = Date.now() - startTime

    console.log(`   Command returned in ${launchTime}ms`)
    console.log(`   Exit code: ${result.exitCode}`)
    console.log(`   Output: ${result.result?.slice(0, 200)}\n`)

    if (launchTime < 2000) {
      console.log("   GOOD: Returned quickly - might support async!\n")
    } else {
      console.log("   NOTE: Took a while - likely blocked until completion.\n")
    }

    // 4. Try nohup variant
    console.log("4. Trying nohup variant...")
    const outputFile2 = "/tmp/codex-output2.jsonl"
    const nohupCommand = `nohup sh -c 'codex exec --json --skip-git-repo-check --yolo "${prompt}" >> ${outputFile2} 2>&1; echo 1 > ${outputFile2}.done' > /dev/null 2>&1 & echo $!`

    const startTime2 = Date.now()
    const result2 = await sandbox.process.executeCommand(
      nohupCommand,
      undefined,
      { OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY!) },
      120
    )
    const launchTime2 = Date.now() - startTime2

    console.log(`   nohup command returned in ${launchTime2}ms`)
    console.log(`   Exit code: ${result2.exitCode}`)
    console.log(`   Output (PID?): ${result2.result?.trim()}\n`)

    if (launchTime2 < 2000) {
      console.log("   GOOD: nohup returned quickly!\n")

      // Wait and poll
      console.log("5. Waiting 2 seconds then polling...")
      await new Promise((r) => setTimeout(r, 2000))

      let cursor = 0
      let pollCount = 0
      while (pollCount < 120) {
        pollCount++
        const pollResult = await sandbox.process.executeCommand(`cat ${outputFile2} 2>/dev/null || true`)
        const content = pollResult.result || ""

        const newContent = content.slice(cursor)
        if (newContent) {
          process.stdout.write(newContent)
          cursor = content.length
        }

        const doneCheck = await sandbox.process.executeCommand(
          `test -f ${outputFile2}.done && echo done || echo running`
        )
        if (doneCheck.result?.trim() === "done") {
          console.log("\n\n   Process completed!")
          break
        }

        await new Promise((r) => setTimeout(r, 500))
      }
    } else {
      console.log("   NOTE: nohup also blocked.\n")
    }

    console.log("\n=== executeCommand Method Complete ===")
    console.log(`Simple & launch time: ${launchTime}ms`)
    console.log(`nohup launch time: ${launchTime2}ms`)
    console.log(
      "Verdict: " +
        (launchTime2 < 2000
          ? "executeCommand with nohup MAY provide async"
          : "executeCommand BLOCKS even with nohup")
    )
  } finally {
    // Cleanup
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
