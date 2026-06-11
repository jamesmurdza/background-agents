/**
 * Cold-reconnect harness.
 *
 * Simulates a serverless caller that has no memory between invocations: on every
 * poll it acquires a BRAND-NEW sandbox connection (`daytona.get`), builds a
 * fresh runner, and rehydrates the handle from JSON. The only state carried
 * across "invocations" is what a real serverless function could persist itself:
 * the serializable handle and an integer cursor.
 *
 * This is what proves both strategies survive disconnection: every read is, by
 * construction, a reconnect.
 */
import type { Daytona, Sandbox } from "@daytonaio/sdk"
import type { BackgroundRunner, RunHandle } from "./types.js"
import { sleep } from "./util.js"

export interface ReconnectReport {
  readonly runner: string
  readonly reconnects: number
  /** Lines accumulated across all incremental reconnects, in order. */
  readonly lines: string[]
  readonly exitCode: number | null
  /** Total bytes pulled from the sandbox across all reconnects. */
  readonly totalBytesFetched: number
  /** Bytes fetched on each individual reconnect (reveals O(n) vs O(n^2)). */
  readonly perReadBytes: number[]
  /** Lines from one final, independent replay-from-zero on a fresh connection. */
  readonly replayLines: string[]
}

export interface ObserveOptions {
  readonly daytona: Daytona
  readonly sandboxId: string
  readonly makeRunner: (sandbox: Sandbox) => BackgroundRunner
  readonly handle: RunHandle
  readonly pollMs?: number
  readonly maxReads?: number
  readonly onTick?: (message: string) => void
}

/** Deep clone via JSON to prove the handle is fully serializable. */
function rehydrate(handle: RunHandle): RunHandle {
  return JSON.parse(JSON.stringify(handle)) as RunHandle
}

export async function observeByReconnecting(opts: ObserveOptions): Promise<ReconnectReport> {
  const { daytona, sandboxId, makeRunner, handle } = opts
  const pollMs = opts.pollMs ?? 2000
  const maxReads = opts.maxReads ?? 200
  const log = opts.onTick ?? (() => {})

  let cursor = 0
  let done = false
  let exitCode: number | null = null
  let reconnects = 0
  let runnerName = ""
  const lines: string[] = []
  const perReadBytes: number[] = []

  while (!done && reconnects < maxReads) {
    await sleep(pollMs)

    // ── COLD START ──────────────────────────────────────────────────────────
    // New connection, new runner, rehydrated handle. Zero carried-over state
    // except the cursor (an integer a serverless caller would persist).
    const sandbox = await daytona.get(sandboxId)
    const runner = makeRunner(sandbox)
    runnerName = runner.name
    const result = await runner.readSince(rehydrate(handle), cursor)
    // ────────────────────────────────────────────────────────────────────────

    reconnects++
    cursor = result.cursor
    exitCode = result.exitCode
    done = result.done
    perReadBytes.push(result.bytesFetched)

    if (result.lines.length > 0) {
      lines.push(...result.lines)
      const last = result.lines[result.lines.length - 1]
      log(
        `reconnect #${reconnects}: +${result.lines.length} line(s), ` +
          `${result.bytesFetched}B fetched, last="${last}"`
      )
    } else {
      log(`reconnect #${reconnects}: no new lines, ${result.bytesFetched}B fetched`)
    }
  }

  // Final independent replay-from-zero, again on a fresh cold connection.
  const replaySandbox = await daytona.get(sandboxId)
  const replay = await makeRunner(replaySandbox).readAll(rehydrate(handle))

  return {
    runner: runnerName,
    reconnects,
    lines,
    exitCode,
    totalBytesFetched: perReadBytes.reduce((a, b) => a + b, 0),
    perReadBytes,
    replayLines: replay.lines,
  }
}
