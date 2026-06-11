/**
 * Option C — nohup + files, with real exit codes and byte-offset reads.
 *
 * Launch the command detached in its own process group (so we can reap the
 * whole tree later). Redirect combined output to a file; write the *real* `$?`
 * to a sibling `.exit` file on completion. Reads tail from a byte offset, so a
 * cold caller transfers only the new bytes since its cursor — O(n) total.
 *
 * State lives entirely on the sandbox filesystem, so any cold caller can
 * reconnect with just the output-file path.
 */
import type { Sandbox } from "@daytonaio/sdk"
import type { BackgroundRunner, ReadResult, RunHandle } from "./types.js"
import { completeLines, shortId, shq } from "./util.js"

const DATA_MARKER = "@@DATA@@"

export class FileRunner implements BackgroundRunner {
  readonly name = "Option C — nohup + files (offset reads, real exit code)"

  constructor(private readonly sandbox: Sandbox) {}

  async start(command: string): Promise<RunHandle> {
    const dir = `/tmp/bgrun/${shortId()}`
    const outputFile = `${dir}/output.log`
    const exitFile = `${outputFile}.exit`

    // Inner program: run the user command, send stdout+stderr to the log, then
    // record the true exit status. `setsid` gives the job its own session/group
    // so `kill -- -<pgid>` can reap the command AND its children (e.g. sleep).
    const inner = `${command} >> ${shq(outputFile)} 2>&1; echo $? > ${shq(exitFile)}`
    const launch =
      `mkdir -p ${shq(dir)} && ` +
      `setsid sh -c ${shq(inner)} < /dev/null > /dev/null 2>&1 & ` +
      `echo $!`

    const res = await this.sandbox.process.executeCommand(launch, undefined, undefined, 30)
    const pid = Number((res.result ?? "").trim().split(/\s+/).pop())
    if (!Number.isInteger(pid) || pid < 1) {
      throw new Error(`FileRunner.start: could not parse pid from ${JSON.stringify(res.result)}`)
    }
    // With setsid the new session leader's PID equals its process-group id.
    return { kind: "file", outputFile, pgid: pid }
  }

  async readSince(handle: RunHandle, cursor: number): Promise<ReadResult> {
    if (handle.kind !== "file") throw new Error("FileRunner got a non-file handle")
    const out = shq(handle.outputFile)
    const exit = shq(handle.outputFile + ".exit")

    // One round trip: exit status, then only the bytes after `cursor`.
    // The marker cleanly separates the metadata header from raw log bytes
    // (which may themselves contain newlines).
    const script =
      `EC=$(cat ${exit} 2>/dev/null); ` +
      `printf 'EXIT:%s\\n' "$EC"; ` +
      `printf '%s\\n' ${shq(DATA_MARKER)}; ` +
      `tail -c +${cursor + 1} ${out} 2>/dev/null`

    const res = await this.sandbox.process.executeCommand(script, undefined, undefined, 30)
    return parseFileRead(res.result ?? "", cursor)
  }

  async readAll(handle: RunHandle): Promise<ReadResult> {
    return this.readSince(handle, 0)
  }

  async stop(handle: RunHandle): Promise<void> {
    if (handle.kind !== "file") throw new Error("FileRunner got a non-file handle")
    // Negative pid targets the whole process group → reaps children too.
    await this.sandbox.process.executeCommand(
      `kill -TERM -- -${handle.pgid} 2>/dev/null; sleep 0.3; kill -KILL -- -${handle.pgid} 2>/dev/null; true`,
      undefined,
      undefined,
      10
    )
  }
}

function parseFileRead(raw: string, cursor: number): ReadResult {
  const markerIdx = raw.indexOf(`${DATA_MARKER}\n`)
  const header = markerIdx === -1 ? raw : raw.slice(0, markerIdx)
  const data = markerIdx === -1 ? "" : raw.slice(markerIdx + DATA_MARKER.length + 1)

  const exitMatch = header.match(/EXIT:(\d*)/)
  const exitRaw = exitMatch?.[1] ?? ""
  const exitCode = exitRaw === "" ? null : Number(exitRaw)

  const { lines, consumedBytes } = completeLines(data)
  return {
    lines,
    cursor: cursor + consumedBytes,
    done: exitCode !== null,
    exitCode,
    bytesFetched: Buffer.byteLength(data, "utf8"),
  }
}
