/**
 * Tiny, dependency-free shell + parsing helpers. All shell-string construction
 * in this package goes through `q()` — there is no other quoting path, so the
 * injection surface is one audited function.
 */

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Default parent directory for job directories. */
export const DEFAULT_ROOT = "/tmp/sandbox-jobs"

/**
 * Parse the PID printed by `... & echo $!`. The launcher prints exactly one
 * number on the last line; we take the last whitespace-delimited token.
 */
export function parsePid(output: string | undefined): number {
  const pid = Number((output ?? "").trim().split(/\s+/).pop())
  if (!Number.isInteger(pid) || pid < 1) {
    throw new Error(
      `sandbox-jobs: could not parse pid from ${JSON.stringify((output ?? "").slice(0, 200))}`
    )
  }
  return pid
}

/**
 * Time-sortable, collision-resistant id: `<unix-ms>-<base36 random>`. The
 * timestamp prefix makes `ls` chronological and age-based cleanup trivial; the
 * random suffix avoids collisions when two jobs start in the same millisecond.
 */
export function makeJobId(now: number): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${now}-${rand}`
}

/**
 * Split a freshly-read payload at the last newline. Returns the complete-line
 * prefix (what we commit and advance the cursor past) and how many bytes it
 * occupied. A trailing partial line is left unconsumed for the next read.
 */
export function splitComplete(payload: string): {
  complete: string
  consumedBytes: number
} {
  const lastNewline = payload.lastIndexOf("\n")
  if (lastNewline === -1) return { complete: "", consumedBytes: 0 }
  const complete = payload.slice(0, lastNewline + 1)
  return { complete, consumedBytes: Buffer.byteLength(complete, "utf8") }
}
