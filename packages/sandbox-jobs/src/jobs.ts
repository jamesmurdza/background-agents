/**
 * Daytona-backed implementation of {@link SandboxJobs}.
 *
 * Mechanism (no live connection is ever held open):
 *   1. `start` launches the command detached with `nohup` and explicit
 *      redirection, capturing the leader pid synchronously. The command's
 *      combined output appends to `output.log`; when it finishes, the wrapper
 *      writes the real `$?` to `exit`.
 *   2. `read`/`status` reconstruct the run from the filesystem: the exit file
 *      (clean completion + real code), the process state (liveness / crash),
 *      and a byte-offset `tail` of the log (only new bytes).
 *   3. `cancel` uses a graceful-then-forced sequence (SIGTERM → 500ms → SIGKILL)
 *      plus a name-based `pkill -f` sweep so daemonized children that escaped
 *      the process tree are also reaped.
 *
 * Because the redirection and `echo $? > exit` run sequentially in one shell,
 * the exit file never appears before the output is flushed — so there are no
 * flush races to paper over.
 */
import type { Sandbox } from "@daytonaio/sdk"
import type {
  JobHandle,
  JobRead,
  JobStatus,
  SandboxJobs,
  StartJobOptions,
} from "./types"
import { DEFAULT_ROOT, makeJobId, parsePid, q, splitComplete } from "./shell"

/** Separates the status header from raw log bytes in a read round trip. */
const DATA_MARKER = "@@SBJ-DATA@@"

/** SIGTERM exit convention (128 + 15). Written by cancel() so a cancelled job
 *  reads back as a deterministic clean exit rather than a crash. */
export const CANCELLED_EXIT_CODE = 143

export function createSandboxJobs(sandbox: Sandbox): SandboxJobs {
  async function exec(command: string, timeoutSeconds = 30): Promise<string> {
    const res = await sandbox.process.executeCommand(command, undefined, undefined, timeoutSeconds)
    return res.result ?? ""
  }

  async function start(opts: StartJobOptions): Promise<JobHandle> {
    const root = opts.root ?? DEFAULT_ROOT
    const jobId = makeJobId(Date.now())
    const dir = `${root}/${jobId}`
    const outputFile = `${dir}/output.log`
    const exitFile = `${dir}/exit`

    const envExports = Object.entries(opts.env ?? {})
      .map(([k, v]) => `export ${k}=${q(v)}; `)
      .join("")
    const cd = opts.cwd ? `cd ${q(opts.cwd)} && ` : ""
    const userCmd = opts.timeoutSeconds
      ? `timeout ${opts.timeoutSeconds} sh -c ${q(opts.command)}`
      : `sh -c ${q(opts.command)}`

    // Inner program: (cd &&) export env; run; record true exit.
    const inner = `${cd}${envExports}${userCmd} >> ${q(outputFile)} 2>&1; echo $? > ${q(exitFile)}`
    // CRITICAL: the backgrounded part must be a SIMPLE command so the shell
    // exec-replaces it into a single detached process whose std fds are all on
    // /dev/null. If we instead background a COMPOUND like `mkdir && nohup …`,
    // the shell forks a subshell whose own stdout is still the executeCommand
    // read channel; that subshell lingers for the whole life of the job and
    // keeps the channel open, so the launch call blocks until it times out
    // ("command execution timeout"). So: run the foreground setup (the job dir)
    // first, then background only `nohup …` (fully redirected), then print the pid.
    const launch =
      `mkdir -p ${q(dir)} && ` +
      `{ nohup sh -c ${q(inner)} < /dev/null > /dev/null 2>&1 & echo $!; }`

    const pid = parsePid(await exec(launch))
    const handle: JobHandle = { jobId, dir, outputFile, exitFile, pid, processName: opts.processName }

    // Persist a small job-meta so a cold caller can attach() from just the id.
    // base64 + atomic rename: arbitrary JSON crosses the shell safely and a
    // concurrent reader never observes a half-written file.
    const metaJson = JSON.stringify({
      jobId,
      pid,
      outputFile,
      exitFile,
      dir,
      processName: opts.processName,
      createdAt: new Date(Date.now()).toISOString(),
      version: 1,
    })
    const b64 = Buffer.from(metaJson, "utf8").toString("base64")
    const metaFile = `${dir}/meta.json`
    await exec(
      `printf %s ${q(b64)} | base64 -d > ${q(metaFile)}.tmp && mv ${q(metaFile)}.tmp ${q(metaFile)}`,
      10
    )

    return handle
  }

  /** Shell that prints the `EXIT:`/`STATE:` status header (see parseHeader). */
  function statusHeader(handle: JobHandle): string {
    return (
      `EC=$(cat ${q(handle.exitFile)} 2>/dev/null); printf 'EXIT:%s\\n' "$EC"; ` +
      `ST=$(ps -o state= -p ${handle.pid} 2>/dev/null | tr -d ' \\n'); printf 'STATE:%s\\n' "$ST"; `
    )
  }

  async function read(handle: JobHandle, cursor = 0): Promise<JobRead> {
    // One round trip: status header, then only the bytes after the cursor. The
    // marker cleanly separates the header from raw log bytes (which may
    // themselves contain anything, including the header keywords).
    const script =
      statusHeader(handle) +
      `printf '%s\\n' ${q(DATA_MARKER)}; ` +
      `tail -c +${cursor + 1} ${q(handle.outputFile)} 2>/dev/null`
    return parseRead(await exec(script), cursor)
  }

  async function status(handle: JobHandle): Promise<JobStatus> {
    const { exitRaw, stateRaw } = parseHeader(await exec(statusHeader(handle)))
    return deriveStatus(exitRaw, stateRaw)
  }

  async function cancel(handle: JobHandle): Promise<void> {
    // Three-step kill sequence matching the original pre-sandbox-jobs logic:
    //   1. SIGTERM — graceful shutdown, giving the process a chance to persist
    //      conversation state (fixes "No conversation found" errors).
    //   2. 500ms wait — allow the SIGTERM to be processed.
    //   3. SIGKILL — force kill what's still alive.
    //   4. pkill -f by name — backstop for daemonized children (e.g. MCP
    //      servers that re-session'd themselves) that the pid kill missed.
    // Then write a deterministic exit sentinel so the job reads back as
    // terminal even if the wrapper was killed before it could write `$?`.
    await exec(
      `kill -TERM ${handle.pid} 2>/dev/null || true; ` +
        `sleep 0.5; ` +
        `kill -9 ${handle.pid} 2>/dev/null || true; ` +
        (handle.processName ? `pkill -9 -f ${q(handle.processName)} 2>/dev/null || true; ` : "") +
        `test -f ${q(handle.exitFile)} || echo ${CANCELLED_EXIT_CODE} > ${q(handle.exitFile)}; true`,
      10
    )
  }

  async function attach(jobId: string, root = DEFAULT_ROOT): Promise<JobHandle | null> {
    const dir = `${root}/${jobId}`
    const raw = (await exec(`cat ${q(`${dir}/meta.json`)} 2>/dev/null || true`, 10)).trim()
    if (!raw) return null
    try {
      const m = JSON.parse(raw) as Partial<JobHandle>
      if (!m.outputFile || !m.exitFile || typeof m.pid !== "number") return null
      return {
        jobId,
        dir,
        outputFile: m.outputFile,
        exitFile: m.exitFile,
        pid: m.pid,
        processName: m.processName,
      }
    } catch {
      return null
    }
  }

  return { start, read, status, cancel, attach }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing helpers (no I/O) — exported for unit testing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide job state from the two independent signals:
 *   - exit file present  → clean completion, with the real code.
 *   - no exit file, process alive (non-zombie) → running.
 *   - no exit file, process gone/zombie → crashed (killed before writing $?).
 */
export function deriveStatus(exitRaw: string, stateRaw: string): JobStatus {
  if (exitRaw !== "") {
    return { state: "exited", exitCode: Number(exitRaw), alive: false }
  }
  // Any non-zombie, non-whitespace state char means a live process remains.
  const alive = stateRaw.replace(/[Z\s]/g, "").length > 0
  if (alive) return { state: "running", exitCode: null, alive: true }
  return { state: "crashed", exitCode: null, alive: false }
}

/** Extract the `EXIT:`/`STATE:` fields from a status header. */
export function parseHeader(text: string): { exitRaw: string; stateRaw: string } {
  return {
    exitRaw: text.match(/EXIT:(\d*)/)?.[1] ?? "",
    stateRaw: text.match(/STATE:([^\n]*)/)?.[1] ?? "",
  }
}

export function parseRead(raw: string, cursor: number): JobRead {
  const markerIdx = raw.indexOf(`${DATA_MARKER}\n`)
  const header = markerIdx === -1 ? raw : raw.slice(0, markerIdx)
  const data = markerIdx === -1 ? "" : raw.slice(markerIdx + DATA_MARKER.length + 1)

  const { exitRaw, stateRaw } = parseHeader(header)
  const status = deriveStatus(exitRaw, stateRaw)

  const { complete, consumedBytes } = splitComplete(data)
  return {
    raw: complete,
    cursor: cursor + consumedBytes,
    bytesFetched: Buffer.byteLength(data, "utf8"),
    status,
  }
}
