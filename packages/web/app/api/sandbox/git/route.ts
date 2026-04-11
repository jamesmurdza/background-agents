import { prisma } from "@/lib/db/prisma"
import { checkDuplicateBranchName } from "@/lib/db/branch-helpers"
import { ensureSandboxStarted } from "@/lib/sandbox/sandbox-resume"
import type { Sandbox } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
  getGitHubTokenForUser,
} from "@/lib/shared/api-helpers"
import { generateCommitMessage } from "@/lib/git/commit-message"
// Git operation timeout - 60 seconds (must be literal for Next.js static analysis)
export const maxDuration = 60

/**
 * Verifies we're on the correct branch (no checkout).
 * Prevents agents from pushing to the wrong branch. We only verify so we don't
 * run checkout and wipe or alter the working tree, which was causing empty commits.
 */
async function ensureCorrectBranch(
  sandbox: Sandbox,
  repoPath: string,
  expectedBranch: string
): Promise<string | null> {
  const status = await sandbox.git.status(repoPath)
  if (status.currentBranch !== expectedBranch) {
    return `Branch mismatch: expected ${expectedBranch} but on ${status.currentBranch}`
  }
  return null
}

/** `git commit` exit 1 with nothing staged — not an error for auto-commit-push */
function isGitNothingToCommitMessage(output: string): boolean {
  return /nothing to commit/i.test(output)
}

/**
 * Push with retry logic.
 * Optionally verifies the current branch before each push attempt.
 * Returns the raw error message on failure - let frontend handle display.
 */
async function pushWithRetry(
  sandbox: Sandbox,
  repoPath: string,
  githubToken: string,
  expectedBranch?: string,
  maxRetries = 2
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (expectedBranch) {
        const branchError = await ensureCorrectBranch(sandbox, repoPath, expectedBranch)
        if (branchError) {
          // Retry on branch mismatch - this can happen during branch rename operations
          // where DB is updated before git branch -m completes
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
            continue
          }
          return { success: false, error: branchError }
        }
      }
      await sandbox.git.push(repoPath, "x-access-token", githubToken)
      return { success: true }
    } catch (err: unknown) {
      // The Daytona SDK's axios interceptor already extracts the detailed error message
      // from the API response and wraps it in a DaytonaError. The error.message already
      // contains the extracted message (e.g., "authentication required" instead of
      // "Request failed with status code 400").
      //
      // DaytonaError also has statusCode and headers properties if needed.
      let errorMessage = err instanceof Error ? err.message : String(err)

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }

      return { success: false, error: errorMessage }
    }
  }
  return { success: false, error: "Max retries exceeded" }
}

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, repoPath, action, targetBranch, currentBranch, repoOwner, repoApiName, branchName, squash, branchId } = body

  if (!sandboxId || !repoPath || !action) {
    return badRequest("Missing required fields")
  }

  // Verify ownership
  const sandboxRecord = await prisma.sandbox.findUnique({
    where: { sandboxId },
  })

  if (!sandboxRecord || sandboxRecord.userId !== auth.userId) {
    return notFound("Sandbox not found")
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Get GitHub token from NextAuth
  const githubToken = await getGitHubTokenForUser(auth.userId)

  try {
    const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)

    switch (action) {
      case "status": {
        const status = await sandbox.git.status(repoPath)
        return Response.json(status)
      }

      case "head": {
        // Get current HEAD commit hash
        const headResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse --short HEAD 2>&1`
        )
        if (headResult.exitCode) {
          return Response.json({ error: "Failed to get HEAD: " + headResult.result }, { status: 500 })
        }
        return Response.json({ head: headResult.result.trim() })
      }

      case "log": {
        const sinceCommit = body.sinceCommit
        // Always limit to 10 commits. This caps the worst case when sinceCommit
        // no longer exists in history (e.g., after rebase rewrites commits).
        const logCmd = sinceCommit
          ? `cd ${repoPath} && git log ${sinceCommit}..HEAD --format='{"hash":"%H","shortHash":"%h","author":"%an","email":"%ae","message":"%s","timestamp":"%aI"}' -10 2>&1`
          : `cd ${repoPath} && git log --format='{"hash":"%H","shortHash":"%h","author":"%an","email":"%ae","message":"%s","timestamp":"%aI"}' -10 2>&1`
        const result = await sandbox.process.executeCommand(logCmd)
        if (result.exitCode) {
          return Response.json({ commits: [] })
        }
        const commits = result.result
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line: string) => {
            try { return JSON.parse(line) } catch { return null }
          })
          .filter(Boolean)
        // Find merge-base with the base branch to identify inherited commits
        let mergeBase = ""
        if (targetBranch) {
          const mbResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git merge-base HEAD origin/${targetBranch} 2>&1`
          )
          if (!mbResult.exitCode) {
            mergeBase = mbResult.result.trim()
          }
        }
        return Response.json({ commits, mergeBase })
      }

      case "auto-commit-push": {
        if (!githubToken) {
          return badRequest("GitHub token not found")
        }
        // Check if repo is in a rebase-in-progress state - don't commit/push during conflicts
        const rebaseCheck = await sandbox.process.executeCommand(
          `test -d ${repoPath}/.git/rebase-merge -o -d ${repoPath}/.git/rebase-apply && echo "yes" || echo "no"`
        )
        if (rebaseCheck.result.trim() === "yes") {
          return Response.json({
            error: "Rebase in progress - resolve conflicts before pushing",
            inRebase: true,
          }, { status: 409 })
        }
        const mergeHeadCheckAc = await sandbox.process.executeCommand(
          `test -f ${repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
        )
        if (mergeHeadCheckAc.result.trim() === "yes") {
          return Response.json({
            error: "Merge in progress - resolve conflicts before pushing",
            inMerge: true,
          }, { status: 409 })
        }

        // Get current branch from sandbox
        const currentStatus = await sandbox.git.status(repoPath)
        const currentBranch = currentStatus.currentBranch
        if (!currentBranch) {
          return badRequest("Could not determine current branch")
        }

        // Commit uncommitted changes if any (no branch verification needed for local commit)
        let committed = false
        let commitMessage = ""
        const statusResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git status --porcelain 2>&1`
        )
        if (!statusResult.exitCode && statusResult.result.trim()) {
          // Stage all changes first so we can get a complete diff
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git add -A 2>&1`
          )

          // Get the staged diff to generate an AI commit message
          // Use --cached to see what's staged, and --no-color for clean output
          const diffResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git diff --cached --no-color 2>&1`
          )
          const diff = diffResult.exitCode ? "" : diffResult.result

          // Generate AI commit message (falls back to default if LLM unavailable)
          const commitMessageResult = await generateCommitMessage({
            userId: auth.userId,
            diff,
          })
          commitMessage = commitMessageResult.message

          // Escape the commit message for shell (handle quotes and special chars)
          const escapedMessage = commitMessage.replace(/'/g, "'\\''")

          const commitResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git commit -m '${escapedMessage}' 2>&1`
          )
          if (commitResult.exitCode) {
            if (!isGitNothingToCommitMessage(commitResult.result)) {
              return Response.json({ error: "Commit failed: " + commitResult.result }, { status: 500 })
            }
            // Porcelain showed changes but nothing ended up staged (e.g. empty diff) — skip commit, still allow push
          } else {
            committed = true
          }
        }

        // Check if there are unpushed commits by comparing local HEAD with remote
        // Use ls-remote since single-branch clones don't have origin/branchName refs
        const localHead = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>/dev/null`
        )
        const remoteHead = await sandbox.process.executeCommand(
          `cd ${repoPath} && git ls-remote origin refs/heads/${currentBranch} 2>/dev/null | cut -f1`
        )
        const localSha = localHead.result.trim()
        const remoteSha = remoteHead.result.trim()
        const needsPush = localSha && localSha !== remoteSha

        // Early exit if nothing to push - avoids unnecessary branch verification
        // which can fail during branch rename operations
        if (!needsPush) {
          return Response.json({ committed, pushed: false, commitMessage, currentBranch })
        }

        // Look up the current branch name from DB using branchId
        // This avoids race conditions where client has stale branch name after rename
        const branchId = body.branchId
        let expectedBranch: string | null = null
        if (branchId) {
          const branchRecord = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { name: true },
          })
          if (branchRecord) {
            expectedBranch = branchRecord.name
          }
        }
        // If we have an expected branch from DB, enforce it so we never commit/push to the wrong branch.
        if (expectedBranch) {
          const branchError = await ensureCorrectBranch(sandbox, repoPath, expectedBranch)
          if (branchError) {
            return badRequest(branchError)
          }
        }
        const pushBranch = expectedBranch || currentBranch

        // Push
        const pushResult = await pushWithRetry(sandbox, repoPath, githubToken, pushBranch)
        if (!pushResult.success) {
          return Response.json({ error: "Push failed: " + pushResult.error }, { status: 500 })
        }
        return Response.json({ committed, pushed: true, commitMessage, currentBranch: pushBranch })
      }

      case "pull": {
        if (!githubToken) {
          return badRequest("GitHub token not found")
        }
        await sandbox.git.pull(repoPath, "x-access-token", githubToken)
        return Response.json({ success: true })
      }

      case "list-branches": {
        // Fetch all remote branches first (single-branch clones only see origin/main)
        if (githubToken) {
          const origUrlResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git remote get-url origin 2>&1`
          )
          const origUrl = origUrlResult.result.trim()
          // Temporarily set authed URL for private repos
          const authedUrl = origUrl.replace(
            /^https:\/\//,
            `https://x-access-token:${githubToken}@`
          )
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git remote set-url origin '${authedUrl}' 2>&1`
          )
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git fetch origin --prune 2>&1`
          )
          // Restore original URL
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git remote set-url origin '${origUrl}' 2>&1`
          )
        } else {
          // Best-effort fetch for public repos
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git fetch origin --prune 2>&1`
          )
        }
        const brResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git branch -r --format='%(refname:short)' 2>&1`
        )
        if (brResult.exitCode) {
          return Response.json({ branches: [] })
        }
        const branches = brResult.result
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((b: string) => b.replace("origin/", ""))
          .filter((b: string) => b !== "HEAD")
        return Response.json({ branches })
      }

      case "merge": {
        if (!githubToken) {
          return badRequest("GitHub account required for merge (link GitHub in settings)")
        }
        if (!targetBranch || !currentBranch) {
          return badRequest("Missing branch names for merge")
        }
        if (!repoOwner || !repoApiName) {
          return badRequest("Missing repository owner or name for merge")
        }

        // Get current branch in sandbox to determine if we need to pull after
        const currentStatus = await sandbox.git.status(repoPath)
        const localBranch = currentStatus.currentBranch
        const isMergingIntoActiveBranch = localBranch === targetBranch

        // Check if target branch has a running agent (only if merging into a different branch)
        if (!isMergingIntoActiveBranch) {
          const targetBranchRecord = await prisma.branch.findFirst({
            where: {
              name: targetBranch,
              sandbox: { sandboxId },
            },
            select: { id: true, status: true },
          })
          if (targetBranchRecord?.status === "running") {
            return Response.json(
              { error: `Cannot merge into "${targetBranch}" while an agent is running on it` },
              { status: 409 }
            )
          }
        }

        // Always use GitHub's merge API
        const commitMessage = squash
          ? `Squash merge ${currentBranch} into ${targetBranch}`
          : `Merge ${currentBranch} into ${targetBranch}`

        const mergeRes = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoApiName}/merges`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              base: targetBranch,
              head: currentBranch,
              commit_message: commitMessage,
            }),
          }
        )

        if (!mergeRes.ok) {
          const mergeData = await mergeRes.json().catch(() => ({}))
          const errorMessage = (mergeData as { message?: string }).message || `Status ${mergeRes.status}`
          if (mergeRes.status === 409) {
            // Conflict - only allow resolution if merging into active branch
            if (!isMergingIntoActiveBranch) {
              return Response.json(
                { error: `Merge conflict. Switch to "${targetBranch}" and merge or rebase from there.` },
                { status: 409 }
              )
            }

            // Squash merges cannot be reproduced locally the same way; surface GitHub error only.
            if (squash) {
              return Response.json({ error: "Merge conflict: " + errorMessage }, { status: 409 })
            }

            // Replicate merge in sandbox so conflicts can be resolved (merging into active branch)
            await sandbox.process.executeCommand(`cd ${repoPath} && git fetch origin 2>&1`)

            try {
              await sandbox.git.pull(repoPath, "x-access-token", githubToken)
            } catch {
              // best-effort
            }

            const mergeLocal = await sandbox.process.executeCommand(
              `cd ${repoPath} && git merge origin/${currentBranch} 2>&1`
            )

            const mergeHeadCheck = await sandbox.process.executeCommand(
              `test -f ${repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
            )
            const hasMergeHead = mergeHeadCheck.result.trim() === "yes"

            if (hasMergeHead) {
              const conflictResult = await sandbox.process.executeCommand(
                `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
              )
              const conflictedFiles = conflictResult.result
                .trim()
                .split("\n")
                .filter(Boolean)
              return Response.json(
                {
                  conflict: true,
                  inMerge: true,
                  conflictedFiles,
                  targetBranch,
                  currentBranch,
                  message: mergeLocal.result,
                },
                { status: 409 }
              )
            }

            // Clean merge locally despite GitHub 409 — this shouldn't happen but handle gracefully
            return Response.json({ error: "Merge conflict: " + errorMessage }, { status: 409 })
          }
          return Response.json({ error: "Merge failed: " + errorMessage }, { status: 500 })
        }

        // Merge succeeded on GitHub
        if (isMergingIntoActiveBranch) {
          // Pull to sync sandbox state
          try {
            await sandbox.git.pull(repoPath, "x-access-token", githubToken)
          } catch {
            // Pull may fail but GitHub merge succeeded
          }
        } else {
          // Mark target branch as needing sync when user switches to it
          const targetBranchRecord = await prisma.branch.findFirst({
            where: {
              name: targetBranch,
              sandbox: { sandboxId },
            },
            select: { id: true },
          })
          if (targetBranchRecord) {
            await prisma.branch.update({
              where: { id: targetBranchRecord.id },
              data: { needsSync: true },
            })
          }
        }

        return Response.json({ success: true })
      }

      case "rebase": {
        if (!githubToken || !targetBranch || !currentBranch || !repoOwner || !repoApiName) {
          return badRequest("Missing required fields for rebase")
        }
        // Checkout target branch, pull latest, come back, rebase
        const coTarget2 = await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout ${targetBranch} 2>&1`
        )
        if (coTarget2.exitCode) {
          return Response.json({ error: "Failed to checkout target: " + coTarget2.result }, { status: 500 })
        }
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubToken)
        } catch {
          // Target may already be up to date
        }
        await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
        const rebaseResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rebase ${targetBranch} 2>&1`
        )
        if (rebaseResult.exitCode) {
          // Check if this is a conflict (vs other errors)
          const isConflict = rebaseResult.result.includes("CONFLICT") ||
                             rebaseResult.result.includes("could not apply")

          if (isConflict) {
            // Get list of conflicted files - DON'T abort, let agent resolve
            const conflictResult = await sandbox.process.executeCommand(
              `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
            )
            const conflictedFiles = conflictResult.result.trim().split('\n').filter(Boolean)

            return Response.json({
              conflict: true,
              targetBranch,
              conflictedFiles,
              message: rebaseResult.result,
            }, { status: 409 })
          }

          // Non-conflict error - abort and return error
          await sandbox.process.executeCommand(`cd ${repoPath} && git rebase --abort 2>&1`)
          return Response.json({ error: "Rebase failed: " + rebaseResult.result }, { status: 500 })
        }
        // Move GitHub's branch ref to the new HEAD (non-fast-forward; same outcome as git push --force)
        const shaResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>&1`
        )
        const sha = shaResult.result.trim()
        // GitHub REST: update ref (objects must already exist on GitHub for this to succeed)
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
        if (!refRes.ok) {
          const refData = await refRes.json().catch(() => ({}))
          return Response.json({ error: "Force push failed: " + ((refData as { message?: string }).message || refRes.status) }, { status: 500 })
        }

        // Update startCommit and lastShownCommitHash after rebase completes.
        // Rebase rewrites commit history, so old commit references no longer exist.
        if (branchId) {
          const mergeBaseResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git merge-base HEAD ${targetBranch} 2>/dev/null`
          )
          const newStartCommit = mergeBaseResult.result?.trim()
          const shortSha = sha.substring(0, 7)
          await prisma.branch.update({
            where: { id: branchId },
            data: {
              ...(newStartCommit && !mergeBaseResult.exitCode && { startCommit: newStartCommit }),
              lastShownCommitHash: shortSha,
            },
          })
        }

        return Response.json({ success: true })
      }

      case "abort-rebase": {
        const abortResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rebase --abort 2>&1`
        )
        if (abortResult.exitCode) {
          return Response.json({ error: "Abort failed: " + abortResult.result }, { status: 500 })
        }
        return Response.json({ success: true })
      }

      case "abort-merge": {
        const abortMergeResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git merge --abort 2>&1`
        )
        if (abortMergeResult.exitCode) {
          return Response.json({ error: "Abort failed: " + abortMergeResult.result }, { status: 500 })
        }
        return Response.json({ success: true })
      }

      case "check-rebase-status": {
        // Rebase or merge in progress (merge uses MERGE_HEAD)
        const rebaseCheck = await sandbox.process.executeCommand(
          `test -d ${repoPath}/.git/rebase-merge -o -d ${repoPath}/.git/rebase-apply && echo "yes" || echo "no"`
        )
        const inRebase = rebaseCheck.result.trim() === "yes"

        const mergeHeadCheck = await sandbox.process.executeCommand(
          `test -f ${repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
        )
        const inMerge = mergeHeadCheck.result.trim() === "yes"

        let conflictedFiles: string[] = []
        if (inRebase || inMerge) {
          const conflictResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
          )
          conflictedFiles = conflictResult.result.trim().split("\n").filter(Boolean)
        }

        return Response.json({ inRebase, inMerge, conflictedFiles })
      }

      case "reset": {
        const resetResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git reset --hard HEAD && git clean -fd 2>&1`
        )
        if (resetResult.exitCode) {
          return Response.json({ error: "Reset failed: " + resetResult.result }, { status: 500 })
        }
        return Response.json({ success: true })
      }

      case "diff": {
        const commitHash = body.commitHash
        let diffCmd: string
        if (commitHash) {
          // Single commit diff
          diffCmd = `cd ${repoPath} && git diff ${commitHash}^..${commitHash} 2>&1`
        } else {
          const compareBranch = targetBranch || "HEAD~1"
          diffCmd = `cd ${repoPath} && git diff ${compareBranch}...HEAD 2>&1`
        }
        const diffResult = await sandbox.process.executeCommand(diffCmd)
        return Response.json({ diff: diffResult.result || "" })
      }

      case "delete-remote-branch": {
        if (!currentBranch || !githubToken || !repoOwner || !repoApiName) {
          return badRequest("Missing required fields for delete-remote-branch")
        }
        // Delete remote branch via GitHub API
        const deleteRes = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoApiName}/git/refs/heads/${currentBranch}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        )
        if (!deleteRes.ok && deleteRes.status !== 404) {
          const deleteData = await deleteRes.json().catch(() => ({}))
          return Response.json({ error: "Delete failed: " + ((deleteData as { message?: string }).message || deleteRes.status) }, { status: 500 })
        }
        return Response.json({ success: true })
      }

      case "force-push": {
        // Force-push to sync diverged history while preserving PRs
        // Strategy: create temp branch, push via Daytona SDK to get commits on GitHub,
        // then use GitHub API to force-update the real branch ref.
        if (!currentBranch || !githubToken || !repoOwner || !repoApiName) {
          return badRequest("Missing required fields for force-push")
        }

        // Get local HEAD SHA
        const shaResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>&1`
        )
        if (shaResult.exitCode !== 0) {
          return Response.json({ error: "Failed to get HEAD: " + shaResult.result }, { status: 500 })
        }
        const sha = shaResult.result.trim()

        // Step 1: Create and checkout a temp branch at current HEAD
        const tempBranch = `_cleanup/force-push-${Date.now()}`
        const createBranchResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout -b ${tempBranch} 2>&1`
        )
        if (createBranchResult.exitCode !== 0) {
          return Response.json({ error: "Failed to create temp branch: " + createBranchResult.result }, { status: 500 })
        }

        // Step 2: Push temp branch via Daytona SDK (uploads commits to GitHub)
        try {
          await sandbox.git.push(repoPath, "x-access-token", githubToken)
        } catch (pushErr) {
          // Restore original branch before returning error
          await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
          await sandbox.process.executeCommand(`cd ${repoPath} && git branch -D ${tempBranch} 2>&1`)
          return Response.json({
            error: "Failed to push temp branch: " + (pushErr instanceof Error ? pushErr.message : String(pushErr))
          }, { status: 500 })
        }

        // Step 3: Checkout original branch and delete temp local branch
        await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
        await sandbox.process.executeCommand(`cd ${repoPath} && git branch -D ${tempBranch} 2>&1`)

        // Step 4: Use GitHub API to force-update the real branch ref to the new SHA
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

        // Step 5: Delete the temp remote branch (retry up to 3 times)
        for (let i = 0; i < 3; i++) {
          const deleteRes = await fetch(
            `https://api.github.com/repos/${repoOwner}/${repoApiName}/git/refs/heads/${tempBranch}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github.v3+json",
              },
            }
          )
          if (deleteRes.ok || deleteRes.status === 404) break
          if (i < 2) await new Promise(r => setTimeout(r, 500 * (i + 1)))
        }

        if (!refRes.ok) {
          const refData = await refRes.json().catch(() => ({}))
          return Response.json({
            error: "Force push failed: " + ((refData as { message?: string }).message || refRes.status)
          }, { status: 500 })
        }

        return Response.json({ success: true })
      }

      case "rename-branch": {
        const newName = body.newBranchName
        if (!currentBranch || !newName) {
          return badRequest("Missing required fields for rename")
        }
        // First ensure we're on the branch we're renaming
        const renameBranchError = await ensureCorrectBranch(sandbox, repoPath, currentBranch)
        if (renameBranchError) {
          return badRequest(renameBranchError)
        }

        // Update branch name in database FIRST to prevent race conditions with auto-commit-push.
        // If auto-commit-push runs during rename, it will see the new name in DB and wait for
        // the sandbox to catch up, rather than seeing old DB name + new sandbox name.
        const branchRecord = await prisma.branch.findFirst({
          where: {
            name: currentBranch,
            sandbox: { sandboxId },
          },
        })
        if (branchRecord) {
          // Check if a branch with the new name already exists in this repo
          const duplicateCheck = await checkDuplicateBranchName(branchRecord.repoId, newName)
          if (duplicateCheck) {
            return Response.json(duplicateCheck, { status: 409 })
          }

          await prisma.branch.update({
            where: { id: branchRecord.id },
            data: { name: newName },
          })
        }

        // Track whether branch exists on GitHub (for setting upstream later)
        let branchExistsOnGitHub = false

        // Try to rename on GitHub via API
        if (githubToken && repoOwner && repoApiName) {
          const renameRes = await fetch(
            `https://api.github.com/repos/${repoOwner}/${repoApiName}/branches/${currentBranch}/rename`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ new_name: newName }),
            }
          )
          if (renameRes.ok) {
            branchExistsOnGitHub = true
          } else if (renameRes.status !== 404) {
            // 404 means branch doesn't exist on GitHub yet - that's okay, we'll push after local rename
            // Any other error is a real failure - roll back DB change
            if (branchRecord) {
              await prisma.branch.update({
                where: { id: branchRecord.id },
                data: { name: currentBranch },
              })
            }
            const errorData = await renameRes.json().catch(() => ({}))
            const errorMessage = (errorData as { message?: string }).message || `Status ${renameRes.status}`
            return Response.json(
              { error: `GitHub rename failed: ${errorMessage}` },
              { status: renameRes.status }
            )
          }
        }

        // Rename local branch
        const renameResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git branch -m ${currentBranch} ${newName} 2>&1`
        )
        if (renameResult.exitCode) {
          // Roll back DB change on local rename failure
          if (branchRecord) {
            await prisma.branch.update({
              where: { id: branchRecord.id },
              data: { name: currentBranch },
            })
          }
          return Response.json({ error: "Local rename failed: " + renameResult.result }, { status: 500 })
        }

        // If branch existed on GitHub, set upstream tracking
        // If branch didn't exist on GitHub, push the newly renamed branch
        if (githubToken) {
          if (branchExistsOnGitHub) {
            await sandbox.process.executeCommand(
              `cd ${repoPath} && git branch -u origin/${newName} 2>&1`
            )
          } else {
            // Branch doesn't exist on GitHub yet - push with upstream tracking
            const renamePushResult = await pushWithRetry(sandbox, repoPath, githubToken, newName)
            if (!renamePushResult.success) {
              return Response.json({ error: "Push failed: " + renamePushResult.error }, { status: 500 })
            }
          }
        }

        return Response.json({ success: true })
      }

      default:
        return badRequest(`Unknown action: ${action}`)
    }
  } catch (error: unknown) {
    return internalError(error)
  }
}
