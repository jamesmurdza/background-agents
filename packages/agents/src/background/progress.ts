/**
 * Progress / startup-grace predicates for background polling.
 *
 * Pure helpers used to distinguish "still starting up" from "crashed without
 * output" when a process appears stopped but emitted no terminal event.
 */

import type { Event } from "../types/events"

/** After startedAt, ignore "done but no output" briefly (race with wrapper). */
export const BACKGROUND_STARTUP_GRACE_MS = 4000

/** True if `meta.startedAt` is within the startup grace window from now. */
export function withinStartupGrace(meta: { startedAt?: string }): boolean {
  if (!meta.startedAt) return false
  const t = Date.parse(meta.startedAt)
  if (Number.isNaN(t)) return false
  return Date.now() - t < BACKGROUND_STARTUP_GRACE_MS
}

/**
 * True if the poll result shows any user-observable progress: a streamed
 * token, a tool event, a terminal `end`, or any non-JSON output line.
 */
export function hasObservableBackgroundProgress(result: {
  events: Event[]
  rawOutput?: string
}): boolean {
  for (const e of result.events) {
    if (
      e.type === "token" ||
      e.type === "tool_start" ||
      e.type === "tool_end" ||
      e.type === "end"
    ) {
      return true
    }
  }
  const raw = (result.rawOutput ?? "").trim()
  const nonJsonLines = raw.split("\n").filter((l) => {
    const t = l.trim()
    return t && !(t.startsWith("{") && t.endsWith("}"))
  })
  return nonJsonLines.some((l) => l.trim().length > 0)
}
