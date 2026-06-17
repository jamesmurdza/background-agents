/**
 * Debug logging for the SDK. Enable with env CODING_AGENTS_DEBUG=1 (or non-empty).
 * Logs agent lifecycle (start/stop), background runs, and any lines that fail to parse.
 */

const DEBUG_ENABLED =
  typeof process !== "undefined" &&
  process.env &&
  String(process.env.CODING_AGENTS_DEBUG ?? "").trim() !== ""

export function isDebugEnabled(): boolean {
  return DEBUG_ENABLED
}

const PREFIX = "[agents]"

export function debugLog(message: string, sessionId?: string | null, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return
  const sessionTag = sessionId != null && sessionId !== "" ? ` sessionId=${sessionId}` : ""
  const line = args.length ? `${message} ${args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}` : message
  process.stderr.write(`${PREFIX}${sessionTag} ${line}\n`)
}
