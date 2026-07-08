import { createSandboxGit, type SandboxLike } from "@background-agents/daytona-git"
import { deleteBranchRef } from "@background-agents/common"
import { getUserPushOptions } from "@/lib/git/push-options"

/**
 * List the files with unresolved merge/rebase conflicts in a sandbox repo.
 * Mirrors `git diff --name-only --diff-filter=U`, the standard way to ask git
 * for the still-conflicted paths.
 */
export async function getConflictedFiles(
  sandbox: SandboxLike,
  repoPath: string
): Promise<string[]> {
  const res = await sandbox.process.executeCommand(
    `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
  )
  return res.result.trim().split("\n").filter(Boolean)
}

/**
 * True when a rebase (interactive `rebase-merge` or `git am`-style
 * `rebase-apply`) is currently in progress in the sandbox repo.
 */
export async function isRebaseInProgress(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean> {
  const res = await sandbox.process.executeCommand(
    `test -d ${repoPath}/.git/rebase-merge -o -d ${repoPath}/.git/rebase-apply && echo "yes" || echo "no"`
  )
  return res.result.trim() === "yes"
}

/**
 * True when a merge is currently in progress in the sandbox repo
 * (i.e. `.git/MERGE_HEAD` exists).
 */
export async function hasMergeHead(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean> {
  const res = await sandbox.process.executeCommand(
    `test -f ${repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
  )
  return res.result.trim() === "yes"
}

export interface ConflictState {
  inRebase: boolean
  inMerge: boolean
  conflictedFiles: string[]
}

/**
 * Inspect a sandbox repo's merge/rebase conflict state in one call: whether a
 * rebase or merge is in progress, plus the still-conflicted files (only queried
 * when a rebase/merge is actually underway).
 */
export async function getConflictState(
  sandbox: SandboxLike,
  repoPath: string
): Promise<ConflictState> {
  const inRebase = await isRebaseInProgress(sandbox, repoPath)
  const inMerge = await hasMergeHead(sandbox, repoPath)
  const conflictedFiles =
    inRebase || inMerge ? await getConflictedFiles(sandbox, repoPath) : []
  return { inRebase, inMerge, conflictedFiles }
}

/** Which step of {@link pushViaTemporaryBranch} failed. */
export type TempBranchPushStage = "head" | "create-branch" | "push" | "patch-ref"

export type TempBranchPushResult =
  | { ok: true }
  | { ok: false; stage: TempBranchPushStage; detail: string }

/**
 * Update a remote branch to the sandbox's current HEAD, even when that rewrites
 * history (rebase / force-push).
 *
 * GitHub's update-ref API requires the target SHA to already exist on GitHub,
 * but the sandbox token can't force-push directly. So we push the commits to a
 * throwaway temp branch first (a plain non-force push, always allowed) to ship
 * the objects, then PATCH the real branch ref to that SHA with `force: true`,
 * then delete the temp remote branch.
 *
 * Returns a discriminated result so callers can attach their own user-facing
 * messaging per stage; the mechanics live here so rebase and force-push stay in
 * sync.
 */
export async function pushViaTemporaryBranch(params: {
  sandbox: SandboxLike
  repoPath: string
  githubToken: string
  currentBranch: string
  repoOwner: string
  repoApiName: string
  userId: string
  /** Used to name the temp branch, e.g. "rebase" or "force-push". */
  tempBranchPrefix: string
}): Promise<TempBranchPushResult> {
  const {
    sandbox,
    repoPath,
    githubToken,
    currentBranch,
    repoOwner,
    repoApiName,
    userId,
    tempBranchPrefix,
  } = params
  const git = createSandboxGit(sandbox)

  const shaResult = await sandbox.process.executeCommand(
    `cd ${repoPath} && git rev-parse HEAD 2>&1`
  )
  if (shaResult.exitCode !== 0) {
    return { ok: false, stage: "head", detail: shaResult.result }
  }
  const sha = shaResult.result.trim()

  const tempBranch = `_cleanup/${tempBranchPrefix}-${Date.now()}`
  const createBranchResult = await sandbox.process.executeCommand(
    `cd ${repoPath} && git checkout -b ${tempBranch} 2>&1`
  )
  if (createBranchResult.exitCode !== 0) {
    return { ok: false, stage: "create-branch", detail: createBranchResult.result }
  }

  try {
    const pushOptions = await getUserPushOptions(userId)
    await git.push(repoPath, githubToken, pushOptions)
  } catch (pushErr) {
    await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
    await sandbox.process.executeCommand(`cd ${repoPath} && git branch -D ${tempBranch} 2>&1`)
    const errMsg = pushErr instanceof Error ? pushErr.message : String(pushErr)
    return { ok: false, stage: "push", detail: errMsg }
  }

  await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
  await sandbox.process.executeCommand(`cd ${repoPath} && git branch -D ${tempBranch} 2>&1`)

  const refRes = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoApiName}/git/refs/heads/${currentBranch}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ sha, force: true }),
    }
  )

  for (let i = 0; i < 3; i++) {
    const del = await deleteBranchRef(githubToken, repoOwner, repoApiName, tempBranch)
    if (del.ok) break
    if (i < 2) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
  }

  if (!refRes.ok) {
    const refData = await refRes.json().catch(() => ({}))
    const errMsg = (refData as { message?: string }).message || String(refRes.status)
    return { ok: false, stage: "patch-ref", detail: errMsg }
  }

  return { ok: true }
}
