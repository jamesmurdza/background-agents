/** A patch line from `ChangedFile.lines`, with its place in the old and new file. */
export interface DiffLine {
  text: string
  /** Missing for added lines, hunk headers and "\ No newline at end of file". */
  oldLine?: number
  /** Missing for removed lines, hunk headers and "\ No newline at end of file". */
  newLine?: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Number a file's patch lines, counting from each hunk header. */
export function numberDiffLines(lines: string[]): DiffLine[] {
  let oldLine = 0
  let newLine = 0
  return lines.map((text) => {
    const hunk = HUNK_HEADER.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { text }
    }
    if (text.startsWith("+")) return { text, newLine: newLine++ }
    if (text.startsWith("-")) return { text, oldLine: oldLine++ }
    if (text.startsWith("\\")) return { text }
    return { text, oldLine: oldLine++, newLine: newLine++ }
  })
}

/**
 * Where `lines` are, e.g. `src/app.tsx:42-44`. Uses new-file line numbers, or
 * the old ones when every line was removed.
 */
export function describeLines(path: string, lines: DiffLine[]): string {
  const current = lines.flatMap((line) => line.newLine ?? [])
  const numbers = current.length > 0 ? current : lines.flatMap((line) => line.oldLine ?? [])
  if (numbers.length === 0) return path
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  const range = first === last ? `${first}` : `${first}-${last}`
  return current.length > 0 ? `${path}:${range}` : `${path}:${range} (removed)`
}

/** What a comment on some lines of a diff is about: where they are and the lines themselves. */
export function lineCommentContext(path: string, lines: DiffLine[]): string {
  const code = lines.map((line) => line.text).join("\n")
  return `On ${describeLines(path, lines)}:\n\`\`\`diff\n${code}\n\`\`\``
}
