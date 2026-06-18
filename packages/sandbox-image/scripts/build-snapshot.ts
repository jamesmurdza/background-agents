import { Daytona } from "@daytonaio/sdk"
import { rebuildSnapshot, rotateSnapshot } from "../src/index"

// Rebuilds the named Daytona snapshot used for agent sandboxes.
// Use --rotate for zero-downtime blue/green rotation.
// Default (no flag): deletes existing snapshot first (brief downtime).
async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error("DAYTONA_API_KEY is not set")
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })
  const args = process.argv.slice(2)

  if (args.includes("--rotate")) {
    const result = await rotateSnapshot(daytona, {
      onLog: (line) => console.log(line),
    })
    console.log(`\nRotated snapshot: ${result.snapshot.name}`)
    if (result.deactivatedName) {
      console.log(`Deactivated old snapshot: ${result.deactivatedName}`)
    }
  } else {
    const snapshot = await rebuildSnapshot(daytona, {
      deleteFirst: true,
      onLog: (line) => console.log(line),
    })
    console.log(`Built snapshot: ${snapshot.name}`)
  }
}

main().catch((err) => {
  console.error("Snapshot build failed:", err)
  process.exit(1)
})
