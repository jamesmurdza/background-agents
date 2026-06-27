/**
 * Parsers for git command output
 */

import type { GitStatus, FileStatus, FileStatusType } from "./types"

/**
 * Parse `git status --porcelain -b` output
 *
 * Format:
 * ## branch...origin/branch [ahead N, behind M]
 * XY filename
 *
 * Where X = staged status, Y = unstaged status
 * M = modified, A = added, D = deleted, R = renamed, C = copied, ? = untracked
 */
export function parseGitStatus(
  porcelainOutput: string,
  aheadBehindOutput: string
): GitStatus {
  const lines = porcelainOutput.trim().split("\n").filter(Boolean)

  // Parse branch line: ## branch...origin/branch or ## branch
  const branchLine = lines[0] || "## main"
  const branchMatch = branchLine.match(/^## ([^.\s]+)/)
  const currentBranch = branchMatch?.[1] || "main"

  // Check if branch is published (has tracking info)
  const isPublished = branchLine.includes("...")

  // Parse ahead/behind from separate command output
  // Format: "2\t1" (ahead\tbehind)
  const { ahead, behind } = parseAheadBehind(aheadBehindOutput)

  // Parse file statuses (lines after the branch line)
  const fileStatus: FileStatus[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.length < 3) continue

    const staged = line[0]
    const unstaged = line[1]
    const path = line.slice(3) // Skip "XY "

    // If staged status is not space/?, file has staged changes
    if (staged !== " " && staged !== "?") {
      fileStatus.push({
        path,
        status: parseStatusCode(staged),
        staged: true,
      })
    }

    // If unstaged status is not space, file has unstaged changes
    if (unstaged !== " ") {
      fileStatus.push({
        path,
        status: parseStatusCode(unstaged),
        staged: false,
      })
    }
  }

  return {
    currentBranch,
    ahead,
    behind,
    isPublished,
    fileStatus,
  }
}

/**
 * Parse ahead/behind output from:
 * git rev-list --left-right --count @{upstream}...HEAD
 *
 * Output format: "behind\tahead" (tab-separated)
 */
export function parseAheadBehind(output: string): {
  ahead: number
  behind: number
} {
  const trimmed = output.trim()
  if (!trimmed || trimmed.includes("fatal")) {
    return { ahead: 0, behind: 0 }
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    // Output is "behind ahead" (upstream commits first, then local)
    return {
      behind: parseInt(parts[0], 10) || 0,
      ahead: parseInt(parts[1], 10) || 0,
    }
  }

  return { ahead: 0, behind: 0 }
}

/**
 * Convert git status code to FileStatusType
 */
function parseStatusCode(code: string): FileStatusType {
  switch (code) {
    case "M":
      return "modified"
    case "A":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    case "C":
      return "copied"
    case "?":
      return "untracked"
    default:
      return "modified"
  }
}

/**
 * Parse commit SHA from git commit output
 *
 * Output format: "[branch hash] message"
 */
export function parseCommitSha(output: string): string {
  // Match [branch hash] pattern
  const match = output.match(/\[[\w/-]+ ([a-f0-9]+)\]/)
  if (match) {
    return match[1]
  }

  // Try to find any SHA-like string
  const shaMatch = output.match(/\b([a-f0-9]{7,40})\b/)
  return shaMatch?.[1] || ""
}

/**
 * Parse branch list from git branch output
 */
export function parseBranchList(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^\*?\s+/, "").trim())
    .filter((branch) => branch && !branch.includes("HEAD"))
}
