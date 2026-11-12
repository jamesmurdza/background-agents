import { createSandboxGit, esc, type SandboxLike } from "@background-agents/sandbox-git"
import { UNCOMMITTED_STATUS_COMMAND, parseUncommittedPaths } from "./uncommitted-files"

export interface ChangedFile {
  path: string
  status: "added" | "deleted" | "modified" | "renamed"
  additions: number
  deletions: number
  binary: boolean
  /** Patch lines from the first hunk header on. */
  lines: string[]
  /** Still outside a commit, so a push wouldn't include it. */
  uncommitted: boolean
}

export interface ChangesResult {
  baseBranch: string
  files: ChangedFile[]
  /** The diff hit MAX_DIFF_BYTES, so the last files are cut off or missing. */
  truncated: boolean
}

// Keeps the response well under Vercel's 4.5 MB limit; a lockfile rewrite
// alone can be several MB.
const MAX_DIFF_BYTES = 1_000_000
// Separates the sections of one command's result.
const SEPARATOR = "\x1e"
// A stalled fetch shouldn't hold the panel up.
const FETCH_TIMEOUT_MS = 10_000

/**
 * Everything this branch changed since it left `baseBranch`: commits plus
 * uncommitted edits and new files. Comparing with the merge base leaves out
 * commits that landed on the base branch later. Committed files that already
 * match the base are left out too, since a squash or rebase merge on GitHub
 * copies the changes into new commits and the merge base doesn't move.
 */
export async function inspectChanges(
  sandbox: SandboxLike,
  repoPath: string,
  baseBranch: string,
  token?: string
): Promise<ChangesResult> {
  // New-repo chats never get an `origin` remote (there's nothing to push to
  // yet), so there's no `origin/<baseBranch>` to diff against. Fall back to
  // the local branch in that case instead of failing outright.
  const { exitCode: remoteExitCode } = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git remote get-url origin`
  )
  const hasRemote = remoteExitCode === 0
  const baseRef = hasRemote ? `origin/${baseBranch}` : baseBranch

  if (hasRemote) {
    // Merges happen on GitHub, so refresh the sandbox's copy of the base
    // first. If that fails or stalls, compare with the copy it already has.
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      createSandboxGit(sandbox).fetchBranch(repoPath, baseBranch, token).catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, FETCH_TIMEOUT_MS) }),
    ])
    clearTimeout(timer)
  }

  const diff = "git -c core.quotePath=false diff --no-color --no-ext-diff"
  const command = [
    `cd ${esc(repoPath)} || exit 1`,
    `base=$(git merge-base ${esc(baseRef)} HEAD 2>/dev/null) || exit 2`,
    // New files aren't in `git diff`; diff each against /dev/null instead.
    `{ ${diff} "$base"; git ls-files --others --exclude-standard -z | xargs -0 -r -n1 ${diff} --no-index -- /dev/null; } | head -c ${MAX_DIFF_BYTES + 1}`,
    `printf '${SEPARATOR}'`,
    UNCOMMITTED_STATUS_COMMAND,
    `printf '${SEPARATOR}'`,
    `git diff --name-only --no-renames -z ${esc(baseRef)}`,
  ].join("\n")
  const { result, exitCode } = await sandbox.process.executeCommand(command)
  if (exitCode === 2) throw new Error(`Couldn't find where this branch started from ${baseBranch}.`)
  if (exitCode !== 0) throw new Error(`Couldn't read the changes: ${result.slice(0, 200)}`)

  const sections = result.split(SEPARATOR)
  const differFromBase = new Set(sections.pop()!.split("\0"))
  const uncommitted = new Set(parseUncommittedPaths(sections.pop()!))
  const patch = sections.join(SEPARATOR)
  const files = parsePatch(patch.slice(0, MAX_DIFF_BYTES))
    .map((file) => ({ ...file, uncommitted: uncommitted.has(file.path) }))
    .filter((file) => file.uncommitted || differFromBase.has(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { baseBranch, files, truncated: patch.length > MAX_DIFF_BYTES }
}

/** Split `git diff` output into files. */
export function parsePatch(patch: string): Omit<ChangedFile, "uncommitted">[] {
  const files: Omit<ChangedFile, "uncommitted">[] = []
  for (const block of patch.split(/^(?=diff --git )/m)) {
    if (!block.startsWith("diff --git ")) continue
    const lines = block.replace(/\n$/, "").split("\n")
    const hunkStart = lines.findIndex((line) => line.startsWith("@@"))
    const header = hunkStart === -1 ? lines : lines.slice(0, hunkStart)
    const body = hunkStart === -1 ? [] : lines.slice(hunkStart)
    const renamedTo = header.find((line) => line.startsWith("rename to "))?.slice("rename to ".length)
    // Unless it was renamed, `diff --git a/<path> b/<path>` names the path twice.
    const both = lines[0].slice("diff --git a/".length)
    const path = renamedTo ?? both.slice(0, (both.length - 3) / 2)

    files.push({
      path,
      status: header.some((line) => line.startsWith("new file mode"))
        ? "added"
        : header.some((line) => line.startsWith("deleted file mode"))
          ? "deleted"
          : renamedTo
            ? "renamed"
            : "modified",
      additions: body.filter((line) => line.startsWith("+")).length,
      deletions: body.filter((line) => line.startsWith("-")).length,
      binary: header.some((line) => line.startsWith("Binary files ")),
      lines: body,
    })
  }
  return files
}
