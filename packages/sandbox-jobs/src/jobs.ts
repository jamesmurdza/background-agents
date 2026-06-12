/**
 * Daytona-backed implementation of {@link SandboxJobs}.
 *
 * Mechanism (no live connection is ever held open):
 *   1. `start` launches the command detached with `setsid` (own process group)
 *      and `nohup`-style redirection, capturing the leader pid synchronously.
 *      The command's combined output appends to `output.log`; when it finishes,
 *      the wrapper writes the real `$?` to `exit`.
 *   2. `read`/`status` reconstruct the run from the filesystem: the exit file
 *      (clean completion + real code), the process-group state (liveness /
 *      crash), and a byte-offset `tail` of the log (only new bytes).
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
    const metaFile = `${dir}/meta.json`

    const envExports = Object.entries(opts.env ?? {})
      .map(([k, v]) => `export ${k}=${q(v)}; `)
      .join("")
    const cd = opts.cwd ? `cd ${q(opts.cwd)} && ` : ""
    // Always run the user command in its OWN `sh -c`, so the output redirection
    // and exit-code capture wrap the command as a whole. Without this, a
    // multi-statement command (`a; exit 3`) would redirect only its last
    // statement and could exit the wrapper before `$?` is ever recorded.
    const userCmd = opts.timeoutSeconds
      ? `timeout ${opts.timeoutSeconds} sh -c ${q(opts.command)}`
      : `sh -c ${q(opts.command)}`

    // Inner program: (cd &&) export env; run; record the true exit status.
    // `setsid` gives the job its own session/group so `kill -- -<pgid>` later
    // reaps the command and all its children.
    const inner = `${cd}${envExports}${userCmd} >> ${q(outputFile)} 2>&1; echo $? > ${q(exitFile)}`
    const launch =
      `mkdir -p ${q(dir)} && ` +
      `setsid sh -c ${q(inner)} < /dev/null > /dev/null 2>&1 & ` +
      `echo $!`

    const pgid = parsePid(await exec(launch))
    const handle: JobHandle = { jobId, dir, outputFile, exitFile, pgid }

    // Persist a small job-meta so a cold caller can attach() from just the id.
    // base64 + atomic rename: arbitrary JSON crosses the shell safely and a
    // concurrent reader never observes a half-written file.
    const metaJson = JSON.stringify({
      jobId,
      pgid,
      outputFile,
      exitFile,
      dir,
      createdAt: new Date(Date.now()).toISOString(),
      version: 1,
    })
    const b64 = Buffer.from(metaJson, "utf8").toString("base64")
    await exec(
      `printf %s ${q(b64)} | base64 -d > ${q(metaFile)}.tmp && mv ${q(metaFile)}.tmp ${q(metaFile)}`,
      10
    )

    return handle
  }

  async function read(handle: JobHandle, cursor = 0): Promise<JobRead> {
    // One round trip: exit code, process-group state, then only the bytes after
    // the cursor. The marker cleanly separates the header from raw log bytes
    // (which may themselves contain anything, including the header keywords).
    const script =
      `EC=$(cat ${q(handle.exitFile)} 2>/dev/null); printf 'EXIT:%s\\n' "$EC"; ` +
      `ST=$(ps -o state= -p ${handle.pgid} 2>/dev/null | tr -d ' \\n'); printf 'STATE:%s\\n' "$ST"; ` +
      `printf '%s\\n' ${q(DATA_MARKER)}; ` +
      `tail -c +${cursor + 1} ${q(handle.outputFile)} 2>/dev/null`
    return parseRead(await exec(script), cursor)
  }

  async function status(handle: JobHandle): Promise<JobStatus> {
    const script =
      `EC=$(cat ${q(handle.exitFile)} 2>/dev/null); printf 'EXIT:%s\\n' "$EC"; ` +
      `ST=$(ps -o state= -p ${handle.pgid} 2>/dev/null | tr -d ' \\n'); printf 'STATE:%s' "$ST"`
    const out = await exec(script)
    const exitRaw = out.match(/EXIT:(\d*)/)?.[1] ?? ""
    const stateRaw = out.match(/STATE:([^\n]*)/)?.[1] ?? ""
    return deriveStatus(exitRaw, stateRaw)
  }

  async function cancel(handle: JobHandle): Promise<void> {
    // Negative pid targets the whole process group → reaps children too. Then
    // record a deterministic exit sentinel so the job reads back as terminal
    // even if the wrapper was killed before it could write `$?` itself.
    await exec(
      `kill -TERM -- -${handle.pgid} 2>/dev/null; sleep 0.3; ` +
        `kill -KILL -- -${handle.pgid} 2>/dev/null; ` +
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
      if (!m.outputFile || !m.exitFile || typeof m.pgid !== "number") return null
      return {
        jobId,
        dir,
        outputFile: m.outputFile,
        exitFile: m.exitFile,
        pgid: m.pgid,
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
 *   - no exit file, group alive (any non-zombie process) → running.
 *   - no exit file, group gone/zombie → crashed (killed before writing $?).
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

export function parseRead(raw: string, cursor: number): JobRead {
  const markerIdx = raw.indexOf(`${DATA_MARKER}\n`)
  const header = markerIdx === -1 ? raw : raw.slice(0, markerIdx)
  const data = markerIdx === -1 ? "" : raw.slice(markerIdx + DATA_MARKER.length + 1)

  const exitRaw = header.match(/EXIT:(\d*)/)?.[1] ?? ""
  const stateRaw = header.match(/STATE:([^\n]*)/)?.[1] ?? ""
  const status = deriveStatus(exitRaw, stateRaw)

  const { complete, consumedBytes } = splitComplete(data)
  return {
    raw: complete,
    cursor: cursor + consumedBytes,
    bytesFetched: Buffer.byteLength(data, "utf8"),
    status,
  }
}
