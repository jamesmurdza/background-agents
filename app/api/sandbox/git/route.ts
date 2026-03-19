import { prisma } from "@/lib/prisma"
import { ensureSandboxStarted } from "@/lib/sandbox-resume"
import type { Sandbox } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
} from "@/lib/api-helpers"
import { generateCommitMessage } from "@/lib/commit-message"
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

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, repoPath, action, targetBranch, currentBranch, repoOwner, repoApiName, tagName, branchName } = body

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
  const account = await prisma.account.findFirst({
    where: { userId: auth.userId, provider: "github" },
  })
  const githubToken = account?.access_token

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
        // If sinceCommit is provided, only get commits after that point
        const logCmd = sinceCommit
          ? `cd ${repoPath} && git log ${sinceCommit}..HEAD --format='{"hash":"%H","shortHash":"%h","author":"%an","email":"%ae","message":"%s","timestamp":"%aI"}' 2>&1`
          : `cd ${repoPath} && git log --format='{"hash":"%H","shortHash":"%h","author":"%an","email":"%ae","message":"%s","timestamp":"%aI"}' -30 2>&1`
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
        if (!branchName) {
          return badRequest("Branch name required for push")
        }
        // Ensure we're on the correct branch before any operations
        const branchError = await ensureCorrectBranch(sandbox, repoPath, branchName)
        if (branchError) {
          return badRequest(branchError)
        }
        // Check for uncommitted changes and commit them if any
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
            return Response.json({ error: "Commit failed: " + commitResult.result }, { status: 500 })
          }
          committed = true
        }
        // Double-check we're still on the correct branch before pushing
        const verifyStatus = await sandbox.git.status(repoPath)
        if (verifyStatus.currentBranch !== branchName) {
          return badRequest(`Branch changed during operation: expected ${branchName} but on ${verifyStatus.currentBranch}`)
        }
        // Always push — covers agent-made commits AND new branches with no upstream.
        await sandbox.git.push(repoPath, "x-access-token", githubToken)
        return Response.json({ committed, pushed: true, commitMessage })
      }

      case "push": {
        if (!githubToken) {
          return badRequest("GitHub token not found")
        }
        if (!branchName) {
          return badRequest("Branch name required for push")
        }
        // Ensure we're on the correct branch before pushing
        const pushBranchError = await ensureCorrectBranch(sandbox, repoPath, branchName)
        if (pushBranchError) {
          return badRequest(pushBranchError)
        }
        // Double-check before push
        const pushVerifyStatus = await sandbox.git.status(repoPath)
        if (pushVerifyStatus.currentBranch !== branchName) {
          return badRequest(`Branch mismatch: expected ${branchName} but on ${pushVerifyStatus.currentBranch}`)
        }
        await sandbox.git.push(repoPath, "x-access-token", githubToken)
        return Response.json({ success: true })
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
        if (!githubToken || !targetBranch || !currentBranch) {
          return badRequest("Missing required fields for merge")
        }
        // Use SDK to checkout target branch (safer than git command)
        try {
          await sandbox.git.checkoutBranch(repoPath, targetBranch)
        } catch (err) {
          return Response.json({ error: "Failed to checkout target: " + (err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
        }
        // Verify we're on target branch
        const mergeCheckStatus = await sandbox.git.status(repoPath)
        if (mergeCheckStatus.currentBranch !== targetBranch) {
          return badRequest(`Branch mismatch: expected ${targetBranch} but on ${mergeCheckStatus.currentBranch}`)
        }
        // Pull latest on target via Daytona SDK
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubToken)
        } catch {
          // May fail if target is already up to date or doesn't have upstream
        }
        // Merge current branch into target
        const mergeResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git merge ${currentBranch} --no-edit 2>&1`
        )
        if (mergeResult.exitCode) {
          // Abort the merge on conflict
          await sandbox.process.executeCommand(`cd ${repoPath} && git merge --abort 2>&1`)
          await sandbox.git.checkoutBranch(repoPath, currentBranch)
          return Response.json({ error: "Merge conflict: " + mergeResult.result }, { status: 409 })
        }
        // Double-check we're on target branch before pushing
        const mergeVerifyStatus = await sandbox.git.status(repoPath)
        if (mergeVerifyStatus.currentBranch !== targetBranch) {
          return badRequest(`Branch changed during merge: expected ${targetBranch} but on ${mergeVerifyStatus.currentBranch}`)
        }
        // Push the merged target
        await sandbox.git.push(repoPath, "x-access-token", githubToken)
        // Switch back to current branch
        await sandbox.git.checkoutBranch(repoPath, currentBranch)
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
          await sandbox.process.executeCommand(`cd ${repoPath} && git rebase --abort 2>&1`)
          return Response.json({ error: "Rebase conflict: " + rebaseResult.result }, { status: 409 })
        }
        // Get SHA for force push via GitHub API
        const shaResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>&1`
        )
        const sha = shaResult.result.trim()
        // Force push via GitHub API (PATCH refs)
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
        return Response.json({ success: true })
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

      case "tag": {
        if (!githubToken || !tagName || !repoOwner || !repoApiName) {
          return badRequest("Missing required fields for tag")
        }
        // Create local tag
        const tagResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git tag ${tagName} 2>&1`
        )
        if (tagResult.exitCode) {
          return Response.json({ error: "Tag creation failed: " + tagResult.result }, { status: 500 })
        }
        // Get SHA
        const tagShaResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>&1`
        )
        const tagSha = tagShaResult.result.trim()
        // Push tag via GitHub API
        const tagRefRes = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoApiName}/git/refs`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            body: JSON.stringify({ ref: `refs/tags/${tagName}`, sha: tagSha }),
          }
        )
        if (!tagRefRes.ok) {
          const tagRefData = await tagRefRes.json().catch(() => ({}))
          return Response.json({ error: "Tag push failed: " + ((tagRefData as { message?: string }).message || tagRefRes.status) }, { status: 500 })
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

        // Track whether branch exists on GitHub (for setting upstream later)
        let branchExistsOnGitHub = false

        // Try to rename on GitHub first via API
        // This ensures GitHub and sandbox stay in sync - if GitHub fails, we haven't touched local
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
            // Any other error is a real failure
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
            await sandbox.git.push(repoPath, "x-access-token", githubToken)
          }
        }

        // Update branch name in database
        const branchRecord = await prisma.branch.findFirst({
          where: {
            name: currentBranch,
            sandbox: { sandboxId },
          },
        })
        if (branchRecord) {
          await prisma.branch.update({
            where: { id: branchRecord.id },
            data: { name: newName },
          })
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
