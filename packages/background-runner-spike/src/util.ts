/**
 * Tiny shared helpers. Kept dependency-free so both runners stay elegant.
 */

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Short random id without pulling in a uuid dependency. */
export function shortId(): string {
  // Composed from two base-36 chunks; uniqueness is per-process and good enough
  // for a throwaway sandbox directory / session name.
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `${rand()}${rand()}`.slice(0, 12)
}

/**
 * Split a freshly-read payload into *complete* lines only, and report how many
 * bytes those complete lines occupied. A trailing partial line (a half-written
 * log entry) is intentionally left unconsumed so the next read picks it up whole.
 *
 * This is the core of correct cursor advancement: the cursor only ever moves
 * past bytes we have fully emitted, so reconnecting and re-reading never drops
 * nor duplicates a line.
 */
export function completeLines(payload: string): {
  lines: string[]
  consumedBytes: number
} {
  const lastNewline = payload.lastIndexOf("\n")
  if (lastNewline === -1) return { lines: [], consumedBytes: 0 }
  const complete = payload.slice(0, lastNewline + 1)
  const lines = complete.split("\n").filter((l) => l.length > 0)
  return { lines, consumedBytes: Buffer.byteLength(complete, "utf8") }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
