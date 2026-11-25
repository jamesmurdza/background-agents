/**
 * Daytona-backed implementation of {@link SandboxJobs}.
 *
 * Mechanism (no live connection is ever held open):
 *   1. `start` launches the command detached with `setsid` (own process group)
 *      and `nohup`-style redirection, capturing the leader pid synchronously.
 *      The command's combined output appends to `output.log`; when it finishes,
 *      the wrapper records the real `$?` in `command-exit` and `exit`. The leader also joins a
 *      per-job cgroup so `cancel` can reap EVERY descendant — including ones
 *      that escape the process group via `setsid()` (e.g. a daemonized MCP
 *      server) — by writing the cgroup's `cgroup.kill`.
 *   2. `read`/`status` reconstruct the run from the filesystem: the exit file
 *      (clean completion + real code), the process-group state (liveness /
 *      crash), and a byte-offset `tail` of the log (only new bytes).
 *
 * Because the redirection and `echo $? > exit` run sequentially in one shell,
 * the exit file never appears before the output is flushed — so there are no
 * flush races to paper over.
 */
import type { Sandbox } from "@daytonaio/sdk"
import { createHash } from "node:crypto"
import type {
  JobHandle,
  JobRead,
  JobStatus,
  SandboxJobs,
  StartJobOptions,
} from "./types"
import { cgroupPath, DEFAULT_ROOT, makeJobId, q, splitComplete } from "./shell"
import { sandboxDiagnostic } from "./diagnostics"

/** Separates the status header from raw log bytes in a read round trip. */
const DATA_MARKER = "@@SBJ-DATA@@"

/** SIGTERM exit convention (128 + 15). Written by cancel() so a cancelled job
 *  reads back as a deterministic clean exit rather than a crash. */
export const CANCELLED_EXIT_CODE = 143

export function createSandboxJobs(sandbox: Sandbox): SandboxJobs {
  async function exec(
    operation: string,
    command: string,
    timeoutSeconds = 30,
    env?: Record<string, string>,
  ): Promise<string> {
    const res = await sandbox.process.executeCommand(command, undefined, undefined, timeoutSeconds)
      .catch((error: unknown) => {
        // SDK errors can carry request headers and the complete shell command.
        const message = typeof error === "string" ? error
          : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
          : ""
        const detail = sandboxDiagnostic(message, env)
        throw new Error(`Could not ${operation}: ${detail || "Sandbox command failed without a diagnostic"}`)
      })
    if (res.exitCode !== 0) {
      // A failed output read can include partial agent output after the marker.
      const output = (res.result ?? "").split(DATA_MARKER, 1)[0].replace(/^EXIT:\d*\nSTATE:[^\n]*\n/, "")
      const detail = sandboxDiagnostic(output, env)
      const exit = typeof res.exitCode === "number" ? `exit code ${res.exitCode}` : "no exit code"
      throw new Error(`Could not ${operation} (${exit}): ${detail || "Sandbox command failed without a diagnostic"}`)
    }
    return res.result ?? ""
  }

  function jobDir(jobId: string, root: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(jobId)) throw new Error("Invalid sandbox job id")
    return `${root}/${jobId}`
  }

  function parseHandle(raw: string, jobId: string, root: string, commandFingerprint?: string): JobHandle {
    const dir = jobDir(jobId, root)
    let m: Partial<JobHandle> & { commandFingerprint?: string }
    try { m = JSON.parse(raw) as typeof m } catch { throw new Error("Sandbox job metadata is unreadable") }
    if (m.jobId !== jobId || !Number.isSafeInteger(m.pgid) || (m.pgid ?? 0) < 1 ||
        m.outputFile !== `${dir}/output.log` || m.exitFile !== `${dir}/exit`) {
      throw new Error("Sandbox job metadata is invalid")
    }
    if (commandFingerprint && m.commandFingerprint !== commandFingerprint) {
      throw new Error("Sandbox job attempt is already bound to a different command")
    }
    return { jobId, dir, outputFile: m.outputFile, exitFile: m.exitFile,
      pgid: m.pgid!, cgroup: cgroupPath(jobId), processName: m.processName }
  }

  function readRecord(dir: string): string {
    const meta = q(`${dir}/meta.json`)
    return `if [ -e ${meta} ]; then [ -f ${meta} ] || exit 1; printf 'SBJ-PRESENT\\n'; cat ${meta}; ` +
      `else printf 'SBJ-MISSING\\n'; fi`
  }

  function parseRecord(raw: string, jobId: string, root: string): JobHandle | null {
    if (raw === "SBJ-MISSING") return null
    if (!raw.startsWith("SBJ-PRESENT\n")) throw new Error("Sandbox job metadata response is incomplete")
    return parseHandle(raw.slice("SBJ-PRESENT\n".length), jobId, root)
  }

  async function start(opts: StartJobOptions): Promise<JobHandle> {
    const root = opts.root ?? DEFAULT_ROOT
    const jobId = opts.jobId ?? makeJobId(Date.now())
    const dir = jobDir(jobId, root)
    const outputFile = `${dir}/output.log`
    const exitFile = `${dir}/exit`
    const metaFile = `${dir}/meta.json`
    // One cgroup per job. Killing it reaps EVERY descendant, including children
    // that re-session themselves (setsid) and so escape the process group.
    const cgroup = cgroupPath(jobId)

    if (Object.keys(opts.env ?? {}).some((key) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))) {
      throw new Error("Invalid sandbox job environment key")
    }
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

    // Move the leader into the job cgroup BEFORE it spawns anything, so every
    // descendant inherits membership. cgroup membership, unlike a process
    // group, survives setsid() — which is what makes cancel() able to reap an
    // escaped child that a process-group kill would miss.
    const cgJoin = `sudo -n mkdir -p ${q(cgroup)} && echo $$ | sudo -n tee ${q(`${cgroup}/cgroup.procs`)} >/dev/null || exit $?; `
    // Inner program: join cgroup; (cd &&) export env; run; record true exit.
    // `setsid` detaches the job into its own session and gives a stable leader
    // pid (== pgid) for liveness/crash detection.
    const commandFingerprint = createHash("sha256").update(JSON.stringify({
      command: opts.command, cwd: opts.cwd ?? null, timeoutSeconds: opts.timeoutSeconds ?? null,
    })).digest("hex")
    const metaPrefix = Buffer.from(JSON.stringify({
      jobId, processName: opts.processName, outputFile, exitFile, dir,
      createdAt: new Date().toISOString(), version: 3, commandFingerprint,
    }).slice(0, -1), "utf8").toString("base64")
    // The detached wrapper owns the launch lock. It writes its own stable pid
    // before running user code, so even a lost launch response is recoverable.
    // Every duplicate launcher and abort uses this same sandbox-local lock.
    const inner =
      `exec 9> ${q(`${dir}/launch.lock`)}; flock -x -w 10 9 || { echo 'Could not acquire the sandbox job launch lock' >&2; exit 1; }; ` +
      `[ ! -f ${q(`${dir}/aborted`)} ] || exit 0; ` +
      `[ ! -e ${q(metaFile)} ] || exit 0; ` + cgJoin +
      `{ printf %s ${q(metaPrefix)} | base64 -d || exit 1; printf ',"pgid":%s}\\n' "$$"; } > ${q(metaFile)}."$$" && ` +
      `mv ${q(metaFile)}."$$" ${q(metaFile)} || exit 1; ` +
      `flock -u 9 || exit 1; exec 9>&-; ` +
      `{ ${cd}{ ${envExports}${userCmd}; }; } >> ${q(outputFile)} 2>&1; RC=$?; ` +
      // Only the foreground-command wrapper writes this completion record.
      // Unlike `exit`, cancel() never synthesizes it. Publish atomically so a
      // reader cannot confuse a partial write with successful completion.
      `printf '%s\\n' "$RC" > ${q(`${dir}/command-exit.tmp`)} && ` +
      `mv ${q(`${dir}/command-exit.tmp`)} ${q(`${dir}/command-exit`)}; ` +
      `printf '%s\\n' "$RC" > ${q(exitFile)}`
    // CRITICAL: the backgrounded part must be a SIMPLE command so the shell
    // exec-replaces it into a single detached process whose std fds are all
    // disconnected from the exec response. If we background `mkdir && setsid …`,
    // the shell forks a subshell whose own stdout is still the executeCommand
    // read channel; that subshell lingers for the whole life of the job and
    // keeps the channel open, so the launch call blocks until it times out
    // ("command execution timeout"). Redirect bootstrap diagnostics to a file
    // unique to this launch call so retries cannot read another caller's error.
    const launchRecord =
      `if [ -f ${q(`${dir}/aborted`)} ]; then printf 'SBJ-ABORTED\\n'; exit 0; fi; ` +
      `if [ -f ${q(metaFile)} ]; then cat ${q(metaFile)}; exit $?; fi; `
    const launch = `mkdir -p ${q(dir)} 2>&1 || exit $?; ` + launchRecord +
      `DIAGNOSTIC=$(mktemp ${q(`${dir}/launch-error.XXXXXX`)} 2>&1) || { RC=$?; printf '%s\\n' "$DIAGNOSTIC"; exit "$RC"; }; ` +
      `trap 'rm -f -- "$DIAGNOSTIC"' EXIT; ` +
      `setsid sh -c ${q(inner)} < /dev/null > "$DIAGNOSTIC" 2>&1 & ` +
      `for ATTEMPT in $(seq 1 100); do ` +
      launchRecord + `sleep 0.05; done; ` +
      `if [ -s "$DIAGNOSTIC" ]; then cat "$DIAGNOSTIC"; else echo 'Timed out waiting for the sandbox job to publish its launch record'; fi; exit 1`
    const result = (await exec("start sandbox job", launch, 15, opts.env)).trim()
    if (result === "SBJ-ABORTED") throw new Error("Sandbox job attempt was cancelled")
    return parseHandle(result, jobId, root, commandFingerprint)
  }

  /** Reconstruct command liveness separately from descendant ownership.
   * A completed command may intentionally leave a server in its cgroup. That
   * group stays available for explicit cleanup, but must not hold the next
   * agent turn. Without confirmed completion, retain the full liveness guard. */
  function statusHeader(handle: JobHandle): string {
    const completionFile = q(`${handle.dir}/command-exit`)
    return (
      // Observe processes before exit records: a wrapper that disappears while
      // being observed must already have published its completion to qualify.
      `PS=$(ps -eo pid=,pgid=,stat=) || exit 1; ` +
      `ST=$(printf '%s\\n' "$PS" | awk '$2 == ${handle.pgid} { print substr($3, 1, 1) }' | tr -d ' \\n'); ` +
      `LEADER=$(printf '%s\\n' "$PS" | awk '$1 == ${handle.pgid} && $3 !~ /^Z/ { print $1 }'); ` +
      `if [ -d ${q(handle.cgroup)} ]; then ` +
      `CG=$(cat ${q(`${handle.cgroup}/cgroup.events`)}) || exit 1; ` +
      `case "$CG" in *'populated 1'*) ST="$ST"S ;; *'populated 0'*) ;; *) exit 1 ;; esac; fi; ` +
      `GROUP_STATE="$ST"; ` +
      `EC=''; if [ -f ${q(handle.exitFile)} ]; then EC=$(cat ${q(handle.exitFile)}) || exit 1; fi; ` +
      `if [ -n "$EC" ] && [ -z "$LEADER" ] && [ -f ${completionFile} ] && ` +
      `[ ! -e ${q(`${handle.dir}/cancelling`)} ] && [ ! -e ${q(`${handle.dir}/aborted`)} ]; then ` +
      `COMMAND_EC=$(cat ${completionFile}) || exit 1; ` +
      `[ "$COMMAND_EC" = "$EC" ] && ST=''; fi; ` +
      `printf 'EXIT:%s\\nSTATE:%s\\n' "$EC" "$ST"; ` +
      // Never remove a populated service cgroup just because the command ended.
      `[ -n "$EC" ] && [ -z "$GROUP_STATE" ] && sudo -n rmdir ${q(handle.cgroup)} 2>/dev/null; true; `
    )
  }

  async function read(handle: JobHandle, cursor = 0): Promise<JobRead> {
    // One round trip: status header, then only the bytes after the cursor. The
    // marker cleanly separates the header from raw log bytes (which may
    // themselves contain anything, including the header keywords).
    const script =
      statusHeader(handle) +
      `printf '%s\\n' ${q(DATA_MARKER)}; ` +
      `if [ -f ${q(handle.outputFile)} ]; then tail -c +${cursor + 1} ${q(handle.outputFile)}; fi`
    return parseRead(await exec("read sandbox job output", script), cursor)
  }

  async function status(handle: JobHandle): Promise<JobStatus> {
    const { exitRaw, stateRaw } = parseHeader(await exec("read sandbox job status", statusHeader(handle)))
    return deriveStatus(exitRaw, stateRaw)
  }

  async function cancel(handle: JobHandle): Promise<void> {
    // Scoped termination:
    //   1. SIGTERM to the process group — graceful shutdown, gives the agent
    //      (e.g. Claude Code) a chance to persist conversation state before
    //      being killed. This is what fixes the "No conversation found" error.
    //   2. 500ms wait — allow SIGTERM to be processed.
    //   3. cgroup.kill — SIGKILLs EVERY member of the job cgroup, including
    //      children that escaped the process group via setsid() (e.g. daemonized
    //      MCP servers), which a process-group kill would miss.
    //   4. SIGKILL to the same process group as a fallback. Never sweep by
    //      provider name: it can kill another job or this cancellation shell.
    // Check actual process-group/cgroup liveness before writing an exit file.
    // The exit sentinel itself cannot prove cancellation: writing it while a
    // process remains alive would make later status() calls falsely terminal.
    // Zombie members are no longer executing and must not prevent Stop.
    const confirmStopped =
      `for ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do ` +
      `PS=$(ps -eo pgid=,stat=) || exit 1; ` +
      `LIVE=$(printf '%s\\n' "$PS" | awk '$1 == ${handle.pgid} && $2 !~ /^Z/ { print $1 }') || exit 1; ` +
      `if [ -d ${q(handle.cgroup)} ]; then ` +
      `CG=$(cat ${q(`${handle.cgroup}/cgroup.events`)}) || exit 1; ` +
      `case "$CG" in *'populated 1'*) LIVE=1 ;; *'populated 0'*) ;; *) exit 1 ;; esac; fi; ` +
      `[ -z "$LIVE" ] && break; sleep 0.1; done; ` +
      `[ -z "$LIVE" ] || exit 1; `
    const result = await exec("confirm the sandbox job stopped",
      // A terminating command can record an exit while a child still runs.
      // Readers must keep the full group guard throughout cancellation.
      `printf 'cancelling\\n' > ${q(`${handle.dir}/cancelling`)} || exit 1; ` +
      `kill -TERM -- -${handle.pgid} 2>/dev/null || true; ` +
        `sleep 0.5; ` +
        `echo 1 | sudo -n tee ${q(`${handle.cgroup}/cgroup.kill`)} >/dev/null 2>&1; ` +
        `kill -KILL -- -${handle.pgid} 2>/dev/null || true; ` +
        confirmStopped +
        `{ test -f ${q(handle.exitFile)} || echo ${CANCELLED_EXIT_CODE} > ${q(handle.exitFile)}; } || exit 1; ` +
        `sudo -n rmdir ${q(handle.cgroup)} 2>/dev/null; printf 'SBJ-CANCELLED\\n'`,
      10
    )
    if (result.trim() !== "SBJ-CANCELLED") {
      throw new Error("Could not confirm the sandbox job stopped: Sandbox did not acknowledge cancellation")
    }
  }

  async function attach(jobId: string, root = DEFAULT_ROOT): Promise<JobHandle | null> {
    const dir = jobDir(jobId, root)
    return parseRecord((await exec("read sandbox job metadata", readRecord(dir), 10)).trim(), jobId, root)
  }

  async function isAborted(jobId: string, root = DEFAULT_ROOT): Promise<boolean> {
    const dir = jobDir(jobId, root)
    const result = await exec("check whether the sandbox job was aborted",
      `if [ -f ${q(`${dir}/aborted`)} ]; then printf 'yes'; else printf 'no'; fi`, 10)
    if (result !== "yes" && result !== "no") throw new Error("Sandbox job abort state is unknown")
    return result === "yes"
  }

  async function abort(jobId: string, root = DEFAULT_ROOT): Promise<void> {
    const dir = jobDir(jobId, root)
    // A lock-protected durable tombstone fences launch even if the web worker
    // that originally requested start wakes much later. Never remove it.
    const raw = (await exec("abort sandbox job", `mkdir -p ${q(dir)} || exit 1; exec 9> ${q(`${dir}/launch.lock`)}; ` +
      `flock -x -w 10 9 || exit 1; printf 'aborted\\n' > ${q(`${dir}/aborted`)} || exit 1; ` +
      readRecord(dir), 15)).trim()
    const handle = parseRecord(raw, jobId, root)
    if (handle) await cancel(handle)
  }

  return { start, read, status, cancel, attach, abort, isAborted }
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
  // statusHeader removes completed-command descendants from this execution
  // signal only after authoritative completion. An exit file alone never
  // overrides a live/uncertain execution or a cancellation in progress.
  // ps STAT may append modifiers (for example Zs or Z+). Those describe the
  // zombie, not an additional running process. Unknown states remain live.
  const alive = stateRaw.replace(/Z[<NLsl+]*|\s/g, "").length > 0
  if (alive) return { state: "running", exitCode: null, alive: true }
  if (exitRaw !== "") {
    return { state: "exited", exitCode: Number(exitRaw), alive: false }
  }
  // Any non-zombie, non-whitespace state char means a live process remains.
  return { state: "crashed", exitCode: null, alive: false }
}

/** Extract the `EXIT:`/`STATE:` fields from a status header. */
export function parseHeader(text: string): { exitRaw: string; stateRaw: string } {
  if (!/^EXIT:\d*\nSTATE:[^\n]*\n/.test(text)) throw new Error("Sandbox job status is incomplete")
  return {
    exitRaw: text.match(/EXIT:(\d*)/)?.[1] ?? "",
    stateRaw: text.match(/STATE:([^\n]*)/)?.[1] ?? "",
  }
}

export function parseRead(raw: string, cursor: number): JobRead {
  const markerIdx = raw.indexOf(`${DATA_MARKER}\n`)
  if (markerIdx === -1) throw new Error("Sandbox job output response is incomplete")
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
