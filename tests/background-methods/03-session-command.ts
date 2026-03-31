/**
 * Test: Run Codex using executeSessionCommand
 *
 * This method uses session-based command execution which maintains state.
 * We test if runAsync option provides true background execution.
 *
 * HYPOTHESIS: Sessions might support async via runAsync parameter
 */

import { Daytona } from "@daytonaio/sdk"

// Clean API key (remove hidden chars like \r)
const cleanEnv = (val: string) => val.replace(/[\r\n\s]/g, "")

async function main() {
  console.log("=== executeSessionCommand Background Method ===\n")

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

    // 3. Create a session
    console.log("3. Creating session...")
    const sessionId = `codex-session-${Date.now()}`
    await sandbox.process.createSession(sessionId)
    console.log(`   Session created: ${sessionId}\n`)

    // 4. Set up environment in session
    console.log("4. Setting up environment in session...")
    await sandbox.process.executeSessionCommand(sessionId, {
      command: `export OPENAI_API_KEY='${cleanEnv(process.env.OPENAI_API_KEY!)}'`,
    })
    console.log("   Environment set.\n")

    // 5. Try running codex with runAsync: true
    console.log("5. Starting Codex with runAsync: true...")
    const outputFile = "/tmp/codex-session-output.jsonl"
    const prompt = "Write a hello world Python script and run it"
    const command = `codex exec --json --skip-git-repo-check --yolo "${prompt}" >> ${outputFile} 2>&1; echo 1 > ${outputFile}.done`

    const startTime = Date.now()
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: command,
        runAsync: true, // Try async mode
      },
      120
    )
    const launchTime = Date.now() - startTime

    console.log(`   Command returned in ${launchTime}ms`)
    console.log(`   Result: ${JSON.stringify(result).slice(0, 300)}\n`)

    if (launchTime < 2000) {
      console.log("   GOOD: runAsync returned quickly!\n")

      // Wait and poll
      console.log("6. Waiting 2 seconds then polling...")
      await new Promise((r) => setTimeout(r, 2000))

      let cursor = 0
      let pollCount = 0
      while (pollCount < 120) {
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
          console.log("\n\n   Process completed!")
          break
        }

        await new Promise((r) => setTimeout(r, 500))
      }
    } else {
      console.log("   NOTE: runAsync still blocked.\n")

      // Try nohup variant in session
      console.log("6. Trying nohup in session...")
      const outputFile2 = "/tmp/codex-session-output2.jsonl"
      const nohupCommand = `nohup sh -c 'codex exec --json --skip-git-repo-check --yolo "${prompt}" >> ${outputFile2} 2>&1; echo 1 > ${outputFile2}.done' > /dev/null 2>&1 & echo $!`

      const startTime2 = Date.now()
      const result2 = await sandbox.process.executeSessionCommand(
        sessionId,
        {
          command: nohupCommand,
          runAsync: true,
        },
        120
      )
      const launchTime2 = Date.now() - startTime2

      console.log(`   nohup in session returned in ${launchTime2}ms`)
      console.log(`   Result: ${JSON.stringify(result2).slice(0, 200)}\n`)

      if (launchTime2 < 2000) {
        console.log("   Polling for results...\n")
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
      }
    }

    console.log("\n=== executeSessionCommand Method Complete ===")
    console.log(`Launch time: ${launchTime}ms`)
    console.log(
      "Verdict: " +
        (launchTime < 2000
          ? "executeSessionCommand with runAsync provides async execution"
          : "executeSessionCommand blocks even with runAsync")
    )
  } finally {
    // Cleanup
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done.")
  }
}

main().catch(console.error)
