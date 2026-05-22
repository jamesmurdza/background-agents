/**
 * Hermes CLI output parser
 *
 * Hermes (`hermes chat -q`) writes:
 *   - The response text to stdout (plain text, may span multiple lines)
 *   - Session info to stderr as:  `\nsession_id: <uuid>`
 *
 * The buildCommand wrapper prefixes all stderr lines with `HERMES_STDERR:`
 * so this parser can distinguish them from response text without a separate
 * file descriptor.
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"

/**
 * Prefix injected by the bash wrapper for all stderr output.
 * Must stay in sync with the sed expression in buildCommand.
 */
export const HERMES_STDERR_PREFIX = "HERMES_STDERR:"

/**
 * Pattern Hermes writes to stderr at the end of a non-interactive run.
 * From cli.py line 14524:
 *   print(f"\nsession_id: {cli.session_id}", file=sys.stderr)
 */
const SESSION_ID_RE = /^session_id:\s*(.+)$/i

/**
 * Parse a single line of output from the Hermes bash wrapper.
 *
 * Lines from stdout → plain text → emit as token events.
 * Lines from stderr (prefixed HERMES_STDERR:) → check for session_id.
 */
export function parseHermesLine(
  line: string,
  context: ParseContext
): Event | Event[] | null {
  // ── Stderr lines ────────────────────────────────────────────────────────
  if (line.startsWith(HERMES_STDERR_PREFIX)) {
    const stderrContent = line.slice(HERMES_STDERR_PREFIX.length)

    const match = stderrContent.match(SESSION_ID_RE)
    if (match) {
      const sessionId = match[1].trim()
      if (sessionId && context.sessionId !== sessionId) {
        context.sessionId = sessionId
        // Emit session event so the background layer persists the ID.
        // The end event is emitted separately when the process exits (exit code 0).
        return { type: "session", id: sessionId }
      }
    }

    // All other stderr output is diagnostic noise — drop it.
    return null
  }

  // ── Stdout lines ─────────────────────────────────────────────────────────
  // Hermes writes the complete response text to stdout. Each line is a token
  // chunk. Preserve newlines between lines (the bash read loop strips the
  // trailing \n so we re-add it for all but potentially the last line).
  //
  // Empty lines within the response are meaningful whitespace — emit them.
  return { type: "token", text: line + "\n" }
}
