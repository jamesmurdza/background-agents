/**
 * Shared contract for both background-process strategies.
 *
 * The whole point of this spike is that a long-running command in a sandbox
 * must be observable from a *cold* caller: a serverless function that starts
 * the command, goes away, and on a later invocation reconnects using nothing
 * but a small serializable handle (plus a cursor it persisted itself).
 *
 * So the contract is deliberately stateless. A runner holds only a sandbox
 * connection; it caches nothing about the run between calls. Everything needed
 * to reconnect lives in `RunHandle` (which round-trips through JSON) and in the
 * integer `cursor` the caller threads back in.
 */

/**
 * Fully serializable pointer to a running (or finished) command.
 * This is the ONLY thing a cold caller needs to reconnect.
 */
export type RunHandle =
  | { readonly kind: "file"; readonly outputFile: string; readonly pgid: number }
  | { readonly kind: "session"; readonly sessionId: string; readonly commandId: string }

/** Result of a single (incremental or full) read. */
export interface ReadResult {
  /** Newly-completed log lines for this read (incremental) or all of them (full). */
  readonly lines: string[]
  /** Opaque cursor to pass to the next incremental read. */
  readonly cursor: number
  /** Has the command finished? */
  readonly done: boolean
  /** Real process exit code once finished, else null. */
  readonly exitCode: number | null
  /**
   * Bytes actually fetched from the sandbox for this read. This is the number
   * that exposes the O(n) vs O(n^2) difference between the two strategies.
   */
  readonly bytesFetched: number
}

/**
 * A strategy for launching, observing, and stopping a long-running command.
 * Implementations must be safe to construct fresh on every call (cold start).
 */
export interface BackgroundRunner {
  /** Human-readable name for reports. */
  readonly name: string

  /** Launch a long-running command; return a serializable handle. */
  start(command: string): Promise<RunHandle>

  /** Read only content produced after `cursor`. Cold-start safe. */
  readSince(handle: RunHandle, cursor: number): Promise<ReadResult>

  /** Replay the entire log from the beginning. Cold-start safe. */
  readAll(handle: RunHandle): Promise<ReadResult>

  /** Terminate the command (and its children). */
  stop(handle: RunHandle): Promise<void>
}
