/**
 * Side-by-side demo. Creates one sandbox, runs the same long command under both
 * strategies (each reconnecting many times), and prints a comparison.
 *
 *   DAYTONA_API_KEY=... npm run demo -w @background-agents/background-runner-spike
 */
import "dotenv/config"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { FileRunner } from "./file-runner.js"
import { SessionRunner } from "./session-runner.js"
import { observeByReconnecting, type ReconnectReport } from "./harness.js"
import type { BackgroundRunner } from "./types.js"

// Counts to 20, ~1.5s per tick (~30s total) — long enough to reconnect ~12x.
const COMMAND = `for i in $(seq 1 20); do echo "tick $i @ $(date +%s)"; sleep 1.5; done`
const POLL_MS = 2500

type Strategy = { label: string; make: (s: Sandbox) => BackgroundRunner }

const STRATEGIES: Strategy[] = [
  { label: "FILE", make: (s) => new FileRunner(s) },
  { label: "SESSION", make: (s) => new SessionRunner(s) },
]

async function main(): Promise<void> {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set")

  const daytona = new Daytona({ apiKey })
  console.log("Creating sandbox…")
  const sandbox = await daytona.create()
  console.log(`Sandbox: ${sandbox.id}\n`)

  const reports: ReconnectReport[] = []
  try {
    for (const { make } of STRATEGIES) {
      const runner = make(sandbox)
      console.log(`\n${"=".repeat(72)}\n${runner.name}\n${"=".repeat(72)}`)

      const handle = await runner.start(COMMAND)
      console.log(`started → ${JSON.stringify(handle)}\n`)

      const report = await observeByReconnecting({
        daytona,
        sandboxId: sandbox.id,
        makeRunner: make,
        handle,
        pollMs: POLL_MS,
        onTick: (m) => console.log("  " + m),
      })
      reports.push(report)
      printReport(report)
    }
  } finally {
    console.log("\nDeleting sandbox…")
    await sandbox.delete().catch(() => {})
  }

  printComparison(reports)
}

function printReport(r: ReconnectReport): void {
  const replayMatches =
    r.replayLines.length === r.lines.length &&
    r.replayLines.every((l, i) => l === r.lines[i])
  console.log(
    `\n  reconnects:        ${r.reconnects}` +
      `\n  lines (incr.):     ${r.lines.length}` +
      `\n  lines (replay):    ${r.replayLines.length}` +
      `\n  incr == replay:    ${replayMatches ? "✓" : "✗ MISMATCH"}` +
      `\n  exit code:         ${r.exitCode}` +
      `\n  bytes fetched:     ${r.totalBytesFetched} total` +
      `\n  per-read bytes:    [${r.perReadBytes.join(", ")}]`
  )
}

function printComparison(reports: ReconnectReport[]): void {
  console.log(`\n${"#".repeat(72)}\nCOMPARISON\n${"#".repeat(72)}`)
  for (const r of reports) {
    const growth =
      r.perReadBytes.length > 1
        ? `${r.perReadBytes[0]}B → ${r.perReadBytes[r.perReadBytes.length - 1]}B per read`
        : "n/a"
    console.log(
      `\n${r.runner}` +
        `\n  total bytes pulled across reconnects: ${r.totalBytesFetched}` +
        `\n  per-read trend (first → last):        ${growth}`
    )
  }
  console.log(
    "\nFile reads stay flat (only new bytes); session reads grow each poll\n" +
      "(whole log re-fetched), which is the O(n) vs O(n^2) trade-off.\n"
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
