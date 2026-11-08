import { esc, type SandboxLike } from "@background-agents/sandbox-git"

// Explicit untracked mode overrides status.showUntrackedFiles=no. NUL output
// keeps whitespace/newlines in filenames from changing record boundaries.
export const UNCOMMITTED_STATUS_COMMAND = "git status --porcelain=v1 -z --untracked-files=all"

/** Paths of non-ignored files that differ from the last commit: new, edited,
 * deleted or renamed, staged or not. Parses `UNCOMMITTED_STATUS_COMMAND`. */
export function parseUncommittedPaths(status: string): string[] {
  const records = status.split("\0")
  const paths: string[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record || record.length < 4) continue
    paths.push(record.slice(3))
    // Porcelain -z emits a second path for renames/copies. It has no XY
    // prefix and must not be interpreted as another status record.
    if (/[RC]/.test(record.slice(0, 2))) i++
  }
  return paths
}

export interface GitWorkingTreeStatus {
  /** Count of files still outside a commit. */
  uncommittedFilesCount: number
  /** Whether the repo has made any commits at all — distinguishes a fresh,
   * genuinely empty scaffold from one with committed work that just happens
   * to have no *uncommitted* files right now. */
  hasCommits: boolean
}

/** One sandbox round-trip for both working-tree signals the no-linked-repo
 * warning needs. Null means Git could not be inspected (sandbox stalled or
 * errored), so callers must keep the last known warning state rather than
 * have one field go stale relative to the other. */
export async function inspectGitWorkingTree(
  sandbox: SandboxLike,
  repoPath: string
): Promise<GitWorkingTreeStatus | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const check = sandbox.process.executeCommand(
      `cd ${esc(repoPath)} && (git rev-parse --verify HEAD >/dev/null 2>&1 && echo yes || echo no) && ${UNCOMMITTED_STATUS_COMMAND} 2>&1`
    )
    // A stalled sandbox call must not keep the chat in "running" indefinitely.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 5000)
    })
    const response = await Promise.race([check, timeout])
    if (!response) return null
    const { result, exitCode } = response
    if (exitCode !== 0) return null
    // First line is the commit-check echo; the rest is the NUL-delimited
    // porcelain status, so splitting on the first newline can't collide
    // with it.
    const newline = result.indexOf("\n")
    if (newline === -1) return null
    const hasCommits = result.slice(0, newline) === "yes"
    const uncommittedFilesCount = parseUncommittedPaths(result.slice(newline + 1)).length
    return { uncommittedFilesCount, hasCommits }
  } catch (error) {
    console.error("[uncommitted-files] Could not inspect Git working tree:", error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
