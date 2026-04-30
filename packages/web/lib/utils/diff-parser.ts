/**
 * Parse unified diff output into structured data
 */

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "header"
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath?: string
  status: "added" | "deleted" | "modified" | "renamed"
  binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export interface ParsedDiff {
  files: DiffFile[]
  stats: {
    files: number
    insertions: number
    deletions: number
  }
}

const FILE_HEADER_REGEX = /^diff --git a\/(.+) b\/(.+)$/
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export function parseDiff(diffOutput: string): ParsedDiff {
  const lines = diffOutput.split("\n")
  const files: DiffFile[] = []
  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // New file header
    const fileMatch = line.match(FILE_HEADER_REGEX)
    if (fileMatch) {
      if (currentFile) {
        files.push(currentFile)
      }
      const oldPath = fileMatch[1]
      const newPath = fileMatch[2]
      currentFile = {
        path: newPath,
        oldPath: oldPath !== newPath ? oldPath : undefined,
        status: "modified",
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      }
      currentHunk = null
      continue
    }

    if (!currentFile) continue

    // Detect file status from index/new/deleted lines
    if (line.startsWith("new file mode")) {
      currentFile.status = "added"
      continue
    }
    if (line.startsWith("deleted file mode")) {
      currentFile.status = "deleted"
      continue
    }
    if (line.startsWith("similarity index") || line.startsWith("rename from")) {
      currentFile.status = "renamed"
      continue
    }
    if (line.startsWith("Binary files")) {
      currentFile.binary = true
      continue
    }

    // Skip --- and +++ lines
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue
    }

    // Hunk header
    const hunkMatch = line.match(HUNK_HEADER_REGEX)
    if (hunkMatch) {
      currentHunk = {
        header: line,
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] || "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      }
      oldLine = currentHunk.oldStart
      newLine = currentHunk.newStart
      currentFile.hunks.push(currentHunk)

      // Add context from hunk header if present
      const context = hunkMatch[5]
      if (context) {
        currentHunk.lines.push({
          type: "header",
          content: context.trim(),
        })
      }
      continue
    }

    if (!currentHunk) continue

    // Diff lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "addition",
        content: line.slice(1),
        newLine: newLine++,
      })
      currentFile.additions++
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "deletion",
        content: line.slice(1),
        oldLine: oldLine++,
      })
      currentFile.deletions++
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      })
    }
  }

  // Don't forget last file
  if (currentFile) {
    files.push(currentFile)
  }

  const stats = {
    files: files.length,
    insertions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  }

  return { files, stats }
}

export interface Commit {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
}

export function parseCommitLog(logOutput: string): Commit[] {
  if (!logOutput.trim()) return []

  return logOutput
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, message, author, date] = line.split("|")
      return {
        sha: sha || "",
        shortSha: shortSha || "",
        message: message || "",
        author: author || "",
        date: date || "",
      }
    })
}
