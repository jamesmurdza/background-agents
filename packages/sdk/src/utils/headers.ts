/**
 * Shared parsing for the user-supplied "Headers" blob used by custom endpoints
 * (Codex / OpenCode). Newline-separated `Name: Value` pairs.
 */

/**
 * Parse the Headers blob into ordered `[name, value]` pairs. Blank lines and
 * `#` comments are skipped; a line needs a non-empty name and value to count.
 * Auth promotion (Authorization → env-backed credential) is handled by callers;
 * this helper just tokenizes.
 */
export function parseHeaderLines(raw: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const line of raw.split("\n").map((l) => l.trim())) {
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!name || !value) continue
    out.push([name, value])
  }
  return out
}
