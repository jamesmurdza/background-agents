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

/** Count of files still outside a commit. Null means Git could not be
 * inspected, so callers must keep the last known warning state. */
export async function inspectUncommittedFiles(
  sandbox: SandboxLike,
  repoPath: string
): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const status = sandbox.process.executeCommand(
      `cd ${esc(repoPath)} && ${UNCOMMITTED_STATUS_COMMAND} 2>&1`
    )
    // A stalled sandbox call must not keep the chat in "running" indefinitely.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 5000)
    })
    const response = await Promise.race([status, timeout])
    if (!response) return null
    const { result, exitCode } = response
    if (exitCode !== 0) return null
    return parseUncommittedPaths(result).length
  } catch (error) {
    console.error("[uncommitted-files] Could not inspect Git status:", error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Whether the repo has made any commits at all. Distinguishes a fresh,
 * genuinely empty scaffold from one with committed work that just happens to
 * have no *uncommitted* files right now — the no-linked-repo warning needs
 * both signals to tell "nothing to lose" apart from "commits only live in
 * the sandbox". Null means Git could not be inspected, so callers must keep
 * the last known warning state. */
export async function hasAnyCommits(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const check = sandbox.process.executeCommand(
      `cd ${esc(repoPath)} && git rev-parse --verify HEAD >/dev/null 2>&1 && echo yes || echo no`
    )
    // Same stall guard as inspectUncommittedFiles — must not keep the chat
    // in "running" indefinitely.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 5000)
    })
    const response = await Promise.race([check, timeout])
    if (!response) return null
    const { result, exitCode } = response
    if (exitCode !== 0) return null
    return result.trim() === "yes"
  } catch (error) {
    console.error("[uncommitted-files] Could not check for commits:", error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
