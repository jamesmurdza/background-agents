/**
 * Minimal, dependency-free parser for `.env`-style text, used to bulk-import
 * environment variables (paste or file upload) in the env vars modal.
 *
 * Supports:
 * - `KEY=value`, `KEY = value`, `export KEY=value`
 * - `#` comment lines and blank lines
 * - inline comments after unquoted values (`KEY=value # comment`)
 * - single-quoted (literal), double-quoted (with \n, \t, \", \\ escapes) and
 *   backtick-quoted values, including values spanning multiple lines
 * - Windows line endings
 */

export interface ParsedEnvEntry {
  key: string
  value: string
}

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, ch: string) => {
    switch (ch) {
      case "n": return "\n"
      case "r": return "\r"
      case "t": return "\t"
      default: return ch
    }
  })
}

/** Find the index of the closing quote, honoring backslash escapes for `"`. */
function findClosingQuote(text: string, quote: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") {
      i++
      continue
    }
    if (text[i] === quote) return i
  }
  return -1
}

export function parseDotEnv(text: string): ParsedEnvEntry[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const entries: ParsedEnvEntry[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const match = LINE_RE.exec(line)
    if (!match) continue

    const key = match[1]
    let rest = match[2]
    let value: string

    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === "`") {
      // Quoted value — may span multiple lines.
      let body = rest.slice(1)
      let end = findClosingQuote(body, quote, 0)
      let j = i
      while (end === -1 && j + 1 < lines.length) {
        j++
        body += "\n" + lines[j]
        end = findClosingQuote(body, quote, 0)
      }
      if (end === -1) {
        // Unterminated quote: treat the original line literally.
        value = rest.trim()
      } else {
        i = j
        value = body.slice(0, end)
        if (quote === '"') value = unescapeDoubleQuoted(value)
      }
    } else {
      // Unquoted: strip inline comments (` #...`) and surrounding whitespace.
      const hash = rest.search(/\s#/)
      if (hash !== -1) rest = rest.slice(0, hash)
      value = rest.trim()
    }

    entries.push({ key, value })
  }

  return entries
}

export interface MergeResult<T> {
  vars: T[]
  added: number
  updated: number
}

/**
 * Merge parsed entries into an existing list: matching keys are updated in
 * place, new keys are appended, and blank placeholder rows are dropped.
 * Later duplicates within `entries` win.
 */
export function mergeEnvEntries<T extends { key: string; value: string }>(
  existing: T[],
  entries: ParsedEnvEntry[],
  create: (entry: ParsedEnvEntry) => T,
): MergeResult<T> {
  const vars = existing.filter((v) => v.key.trim() || v.value)
  const indexByKey = new Map<string, number>()
  vars.forEach((v, i) => indexByKey.set(v.key.trim(), i))

  const addedKeys = new Set<string>()
  const updatedKeys = new Set<string>()
  for (const entry of entries) {
    const idx = indexByKey.get(entry.key)
    if (idx !== undefined) {
      if (!addedKeys.has(entry.key) && vars[idx].value !== entry.value) updatedKeys.add(entry.key)
      vars[idx] = { ...vars[idx], key: entry.key, value: entry.value }
    } else {
      indexByKey.set(entry.key, vars.length)
      addedKeys.add(entry.key)
      vars.push(create(entry))
    }
  }
  return { vars, added: addedKeys.size, updated: updatedKeys.size }
}
