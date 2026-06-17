import { Daytona } from "@daytonaio/sdk"
import { rebuildSnapshot } from "../src/index"

// Rebuilds the named Daytona snapshot used for agent sandboxes.
// Deletes any existing snapshot first so the template is fully refreshed.
async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    console.error("DAYTONA_API_KEY is not set")
    process.exit(1)
  }

  const daytona = new Daytona({ apiKey })
  const snapshot = await rebuildSnapshot(daytona, {
    deleteFirst: true,
    onLog: (line) => console.log(line),
  })

  console.log(`Built snapshot: ${snapshot.name}`)
}

main().catch((err) => {
  console.error("Snapshot build failed:", err)
  process.exit(1)
})
