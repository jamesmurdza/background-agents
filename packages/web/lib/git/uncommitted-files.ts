import { esc, type SandboxLike } from "@background-agents/sandbox-git"

/** Whether new, non-ignored files are still outside a commit. Null means Git
 * could not be inspected, so callers must keep the last known warning state. */
export async function inspectUncommittedFiles(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Explicit untracked mode overrides status.showUntrackedFiles=no. NUL output
    // keeps whitespace/newlines in filenames from changing record boundaries.
    const status = sandbox.process.executeCommand(
      `cd ${esc(repoPath)} && git status --porcelain=v1 -z --untracked-files=all 2>&1`
    )
    // A stalled sandbox call must not keep the chat in "running" indefinitely.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 5000)
    })
    const response = await Promise.race([status, timeout])
    if (!response) return null
    const { result, exitCode } = response
    if (exitCode !== 0) return null

    const records = result.split("\0")
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (!record || record.length < 3) continue
      const index = record[0]
      const worktree = record[1]
      if (index === "?" && worktree === "?") return true
      if (index === "A" || worktree === "A") return true
      // Porcelain -z emits a second path for renames/copies. It has no XY
      // prefix and must not be interpreted as another status record.
      if (index === "R" || index === "C" || worktree === "R" || worktree === "C") i++
    }
    return false
  } catch (error) {
    console.error("[uncommitted-files] Could not inspect Git status:", error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
