/**
 * Option A — Daytona native session API.
 *
 * Launch the command with `executeSessionCommand({ runAsync: true })`. The
 * Daytona daemon supervises it and buffers output, so a cold caller reconnects
 * with just `(sessionId, commandId)` — no filesystem bookkeeping, and the real
 * exit code comes straight from `getSessionCommand`.
 *
 * The catch this spike is meant to expose: `getSessionCommandLogs` is full-dump
 * only (no offset). To honour the same incremental contract we must fetch the
 * whole log every poll and slice client-side — so `bytesFetched` grows with the
 * total log size (O(n^2) across a run), unlike the file strategy.
 */
import type { Sandbox } from "@daytonaio/sdk"
import type { BackgroundRunner, ReadResult, RunHandle } from "./types.js"
import { completeLines, shortId } from "./util.js"

/**
 * Daytona frames each session-log chunk with control bytes (observed: a 3-byte
 * `\x01\x01\x01` stdout marker before every line). Unlike a raw output file,
 * the log stream is NOT byte-exact, so a correct consumer must strip the
 * framing. We remove ASCII control chars except tab and newline.
 *
 * This is deterministic and only touches already-immutable bytes, so slicing by
 * a byte cursor over the de-framed stream stays stable across reconnects.
 */
function deframe(output: string): string {
  // eslint-disable-next-line no-control-regex
  return output.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
}

export class SessionRunner implements BackgroundRunner {
  readonly name = "Option A — Daytona session API (full-dump logs, native exit code)"

  constructor(private readonly sandbox: Sandbox) {}

  async start(command: string): Promise<RunHandle> {
    const sessionId = `bgrun-${shortId()}`
    await this.sandbox.process.createSession(sessionId)
    const res = await this.sandbox.process.executeSessionCommand(
      sessionId,
      { command, runAsync: true },
      30
    )
    const commandId = res.cmdId
    if (!commandId) {
      throw new Error(`SessionRunner.start: no cmdId returned (${JSON.stringify(res)})`)
    }
    return { kind: "session", sessionId, commandId }
  }

  async readSince(handle: RunHandle, cursor: number): Promise<ReadResult> {
    if (handle.kind !== "session") throw new Error("SessionRunner got a non-session handle")

    // Full-dump logs (no offset parameter exists) + the supervised exit code.
    const [logs, info] = await Promise.all([
      this.sandbox.process.getSessionCommandLogs(handle.sessionId, handle.commandId),
      this.sandbox.process.getSessionCommand(handle.sessionId, handle.commandId),
    ])

    const raw = logs.output ?? ""
    const fullBytes = Buffer.byteLength(raw, "utf8")
    // De-frame the daemon's control bytes, then slice client-side from the byte
    // cursor to honour the incremental contract.
    const full = deframe(raw)
    const tail = Buffer.from(full, "utf8").subarray(cursor).toString("utf8")
    const { lines, consumedBytes } = completeLines(tail)

    const exitCode = info.exitCode ?? null
    return {
      lines,
      cursor: cursor + consumedBytes,
      done: exitCode !== null,
      exitCode,
      // The whole log crosses the wire every poll — this is the cost we measure.
      bytesFetched: fullBytes,
    }
  }

  async readAll(handle: RunHandle): Promise<ReadResult> {
    return this.readSince(handle, 0)
  }

  async stop(handle: RunHandle): Promise<void> {
    if (handle.kind !== "session") throw new Error("SessionRunner got a non-session handle")
    // Deleting the session reaps its running command — the native stop. (Also
    // the lifecycle footgun: you must never delete a session you still want.)
    await this.sandbox.process.deleteSession(handle.sessionId).catch(() => {})
  }
}
