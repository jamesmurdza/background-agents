import { Daytona } from "@daytonaio/sdk"
import { rebuildSnapshot } from "../src/index"

// Zero-downtime (re)build of the canonical agent-sandbox snapshot.
// Builds via a transient temp snapshot so new sandboxes always have a ready
// snapshot to launch from. Safe to run while the app is live. See
// rebuildSnapshot() for the step-by-step flow.
async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error("DAYTONA_API_KEY is not set")
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })
  const snapshot = await rebuildSnapshot(daytona, {
    onLog: (line) => console.log(line),
  })
  console.log(`\nActive snapshot: ${snapshot.name}`)
}

main().catch((err) => {
  console.error("Snapshot build failed:", err)
  process.exit(1)
})
