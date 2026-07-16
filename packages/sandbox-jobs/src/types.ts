/**
 * Public contract for running a long-lived shell process in a sandbox and
 * observing it from a *cold* caller.
 *
 * The design rests on one property: a long command in a sandbox must be
 * observable by a caller that started it, went away, and came back later (a
 * serverless function, a restarted server, a different process). So nothing is
 * held in memory between calls. Everything needed to reconnect is either:
 *   - the serializable {@link JobHandle} (round-trips through JSON), or
 *   - the integer byte `cursor` the caller threads back in, or
 *   - the job id alone, via {@link SandboxJobs.attach}.
 *
 * State lives in the sandbox filesystem (one directory per job), never in this
 * process. See {@link SandboxJobs} for the file layout.
 */

/**
 * Fully serializable pointer to a job. This is the ONLY thing (besides a byte
 * cursor) a cold caller needs to read, poll, or cancel a running job.
 */
export interface JobHandle {
  /** Unique, time-sortable job id (`<unix-ms>-<random>`). */
  readonly jobId: string
  /** Job directory in the sandbox: `<root>/<jobId>`. */
  readonly dir: string
  /** Combined stdout+stderr log file, byte-exact, append-only. */
  readonly outputFile: string
  /** Exit-code sentinel file; exists ONLY once the process has finished. */
  readonly exitFile: string
  /**
   * Process-group id of the detached job (== leader pid, thanks to `setsid`).
   * Used for liveness/crash detection (`ps` on the leader); NOT for killing.
   */
  readonly pgid: number
  /**
   * Absolute path to the job's own cgroup-v2 directory. Killing this cgroup is
   * the primary cancellation mechanism: it reaps EVERY descendant, including a
   * child that called `setsid()` and so escaped {@link pgid} (e.g. a daemonized
   * MCP server) — which a process-group kill cannot. Requires cgroup-v2 and the
   * privilege to `mkdir` under `/sys/fs/cgroup` (provided by the sandbox image).
   */
  readonly cgroup: string
  /**
   * Optional process name used for a name-based sweep on cancel (`pkill -f`)
   * as an additional backstop beyond the cgroup kill. Stored in meta for cold
   * reattachment.
   */
  readonly processName?: string
}

/** Lifecycle state of a job, derived from the filesystem on each poll. */
export type JobState =
  /** Process group is alive (and not a zombie). */
  | "running"
  /** Finished cleanly: the exit file is present and holds the real `$?`. */
  | "exited"
  /**
   * The process group is gone but no exit file was ever written — the wrapper
   * was killed before it could record `$?` (SIGKILL, OOM, sandbox reaping).
   * This is the one case a real exit code can't cover, so we detect it by
   * liveness instead.
   */
  | "crashed"

export interface JobStatus {
  readonly state: JobState
  /** The real `$?`, present iff `state === "exited"`; otherwise null. */
  readonly exitCode: number | null
  /** Convenience: `state === "running"`. */
  readonly alive: boolean
}

/**
 * Result of a single read. Always carries status, so one round trip answers
 * both "what's new?" and "is it done?".
 */
export interface JobRead {
  /**
   * New output bytes since `cursor`, truncated to the last complete line. A
   * trailing partial line is intentionally NOT included (and the cursor does
   * not advance past it), so the next read picks it up whole. Because the
   * cursor only ever lands on a newline, it never splits a multi-byte UTF-8
   * character.
   */
  readonly raw: string
  /** Next byte offset to pass to the following read. */
  readonly cursor: number
  /**
   * Bytes actually transferred from the sandbox for this read (including any
   * trailing partial line). Exposes the O(n) cost of incremental reads.
   */
  readonly bytesFetched: number
  readonly status: JobStatus
}

export interface StartJobOptions {
  /** Shell command line to run (its stdout+stderr are captured combined). */
  readonly command: string
  /** Working directory to run the command in. */
  readonly cwd?: string
  /** Environment variables exported before the command runs. */
  readonly env?: Record<string, string>
  /**
   * Optional process name for a name-based sweep on cancel (`pkill -f`).
   * When set, cancel() will also run `pkill -9 -f <processName>` as an
   * additional backstop to catch daemonized children that may escape
   * even the cgroup kill (e.g. processes in other cgroup namespaces).
   */
  readonly processName?: string
  /**
   * Parent directory for the job directory. One subdirectory is created per
   * job. Defaults to `/tmp/sandbox-jobs`.
   */
  readonly root?: string
  /**
   * Hard wall-clock limit for the command (seconds). Implemented with
   * coreutils `timeout`, so on expiry the job exits with code 124 — a real,
   * observable exit code, not a guess. Default: unlimited.
   */
  readonly timeoutSeconds?: number
}

/**
 * A handle to run and observe long-lived shell processes in a single sandbox.
 *
 * File layout, one directory per job:
 * ```
 * <root>/<jobId>/
 *   meta.json     { jobId, pgid, processName, outputFile, exitFile, dir, createdAt, version }
 *   output.log    combined stdout+stderr, byte-exact, append-only
 *   exit          integer $?, present ONLY once the process finishes
 * ```
 */
export interface SandboxJobs {
  /** Launch a detached command; returns a serializable handle immediately. */
  start(opts: StartJobOptions): Promise<JobHandle>
  /**
   * Read output produced after `cursor` (default 0 = from the beginning) and
   * report status, in a single round trip. Cold-start safe.
   */
  read(handle: JobHandle, cursor?: number): Promise<JobRead>
  /** Report job status without reading output. Cold-start safe. */
  status(handle: JobHandle): Promise<JobStatus>
  /**
   * Terminate the job and all its descendants. Sends SIGTERM first (graceful
   * shutdown — gives the process a chance to persist state), then after a
   * 500ms wait kills the job cgroup (reaping even children that escaped the
   * process group via setsid), then runs a name-based `pkill -f` sweep if a
   * processName was provided. The cgroup is removed so page-cache charges
   * don't accumulate.
   */
  cancel(handle: JobHandle): Promise<void>
  /**
   * Rebuild a handle from just the job id, by reading its `meta.json`. Use when
   * a cold caller persisted only the id. Returns null if the job dir is absent
   * or its meta is unreadable.
   */
  attach(jobId: string, root?: string): Promise<JobHandle | null>
}
