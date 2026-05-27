/**
 * Session metadata (meta.json) read/write helpers.
 *
 * meta.json is written by the SDK and read back on every poll. Because it is
 * stored as a file in the sandbox and read via shell commands, naive reads are
 * fragile: a single flaky `cat`, or a read that races a non-atomic write, can
 * yield an empty/partial string. Historically every read site collapsed all of
 * those cases into `null`, which the snapshot layer then misread as "the agent
 * stopped". These helpers centralize parsing, distinguish "absent" from
 * "transiently unreadable", and make writes atomic so readers never observe a
 * torn file.
 */

import type { SessionMeta } from "./types"

/**
 * Printed by the read command when meta.json genuinely does not exist (vs. an
 * empty/failed read). Lets callers tell "never started / cleaned up" apart from
 * "transiently unreadable", so only the latter is retried.
 */
export const META_ABSENT_SENTINEL = "__META_ABSENT__"

/**
 * Parse and validate a raw meta.json string. Returns `null` for empty input,
 * the `{}` placeholder, the absent sentinel, malformed JSON, or any object
 * missing the required numeric fields. This is the single source of truth for
 * "is this a valid meta?" — every read site should funnel through it.
 */
export function parseSessionMeta(
  raw: string | null | undefined
): SessionMeta | null {
  const trimmed = raw?.trim()
  if (!trimmed || trimmed === "{}" || trimmed === META_ABSENT_SENTINEL) {
    return null
  }
  try {
    const o = JSON.parse(trimmed) as SessionMeta
    if (typeof o.currentTurn !== "number" || typeof o.cursor !== "number") {
      return null
    }
    return o
  } catch {
    return null
  }
}

/**
 * Build a shell command that reads meta.json, printing {@link META_ABSENT_SENTINEL}
 * when the file does not exist. Unlike `cat ... 2>/dev/null || true`, this
 * preserves the absent-vs-unreadable distinction:
 *   - output === META_ABSENT_SENTINEL → file absent (don't retry)
 *   - valid JSON                      → parse it
 *   - empty / partial / other         → transient read failure (retry)
 */
export function buildReadMetaCommand(sessionDir: string): string {
  const path = `${sessionDir}/meta.json`
  return `if [ -f "${path}" ]; then cat "${path}"; else echo "${META_ABSENT_SENTINEL}"; fi`
}

/**
 * Build a shell command that writes meta.json **atomically**: write to a unique
 * temp file, then `mv` it into place. `mv` within the same directory is an
 * atomic rename on POSIX filesystems, so a concurrent reader always sees either
 * the complete old file or the complete new file — never an empty or
 * half-written one. If the temp write fails, the `&&` chain short-circuits and
 * the existing meta.json is left untouched.
 */
export function buildAtomicWriteMetaCommand(
  sessionDir: string,
  meta: SessionMeta
): string {
  const json = JSON.stringify(meta)
  const b64 = Buffer.from(json, "utf8").toString("base64")
  // Temp name varies with the meta's identity (run + cursor) so independent
  // writers don't collide on the same temp path.
  const tmp = `${sessionDir}/.meta.${meta.runId ?? "init"}.${meta.currentTurn}.${meta.cursor}.tmp`
  return (
    `mkdir -p "${sessionDir}" && ` +
    `echo '${b64}' | base64 -d > "${tmp}" && ` +
    `mv -f "${tmp}" "${sessionDir}/meta.json"`
  )
}
