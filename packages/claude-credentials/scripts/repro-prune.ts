/**
 * Local repro for the "pull access denied / repository does not exist" failure
 * and its fix.
 *
 * It can't force Daytona's internal image GC on demand, so it *simulates* the
 * prune by deleting the named snapshot after building it — the same split-brain
 * ("nothing to pull") state the production failure lands in — then shows that
 * ensureCCAuthSnapshot rebuilds instead of failing.
 *
 * Requires only DAYTONA_API_KEY (no Claude cookies — this never runs ccauth).
 *
 * Usage:
 *   DAYTONA_API_KEY=... npx tsx packages/claude-credentials/scripts/repro-prune.ts
 */
import { Daytona } from "@daytonaio/sdk"
import {
  resolveLatestCCAuthSha,
  getCCAuthImage,
  getCCAuthSnapshotName,
  ensureCCAuthSnapshot,
} from "../src/generate"

async function main() {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set")

  const sha = await resolveLatestCCAuthSha()
  const name = getCCAuthSnapshotName(sha)
  const image = getCCAuthImage(sha)
  const daytona = new Daytona({ apiKey })

  console.log(`\n[repro] snapshot name: ${name}`)

  // 1. Ensure it exists (first run builds it; later runs reuse).
  console.log("\n[repro] step 1: ensure snapshot exists (may build ~minutes)…")
  await ensureCCAuthSnapshot(daytona, name, image)
  const built = await daytona.snapshot.get(name)
  console.log(`[repro] state after ensure: ${built.state}`)

  // 2. Simulate Daytona pruning the image out from under us.
  console.log("\n[repro] step 2: delete snapshot to simulate a prune…")
  await daytona.snapshot.delete(built)
  const gone = await daytona.snapshot.get(name).catch(() => undefined)
  console.log(`[repro] state after delete: ${gone?.state ?? "missing (pruned)"}`)

  // 3. Old behavior would now hit "pull access denied" on create and never
  //    recover. The fix detects the missing snapshot and rebuilds it.
  console.log("\n[repro] step 3: ensure again — expect an automatic rebuild…")
  await ensureCCAuthSnapshot(daytona, name, image)
  const healed = await daytona.snapshot.get(name)
  console.log(`[repro] state after self-heal: ${healed.state}`)

  console.log(
    healed.state === "active"
      ? "\n✅ PASS: pruned snapshot was rebuilt automatically (bug is fixed)."
      : `\n❌ FAIL: snapshot ended in '${healed.state}'.`,
  )
}

main().catch((err) => {
  console.error("\n[repro] failed:", err)
  process.exit(1)
})
