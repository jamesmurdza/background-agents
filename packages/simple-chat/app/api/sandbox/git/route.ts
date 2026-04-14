import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { sandboxId, repoPath, action, targetBranch, currentBranch, repoOwner, repoApiName, squash } = body

  if (!sandboxId || !repoPath || !action) {
    return Response.json({ error: "Missing required fields: sandboxId, repoPath, action" }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  const githubToken = session.accessToken

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    switch (action) {
      case "list-branches": {
        // Fetch all remote branches
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
        if (!targetBranch || !currentBranch) {
          return Response.json({ error: "Missing branch names for merge" }, { status: 400 })
        }
        if (!repoOwner || !repoApiName) {
          return Response.json({ error: "Missing repository owner or name for merge" }, { status: 400 })
        }

        // Get current branch in sandbox
        const currentStatus = await sandbox.git.status(repoPath)
        const localBranch = currentStatus.currentBranch
        const isMergingIntoActiveBranch = localBranch === targetBranch

        // Use GitHub's merge API
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
            // Conflict
            if (!isMergingIntoActiveBranch) {
              return Response.json(
                { error: `Merge conflict. Switch to "${targetBranch}" and merge from there.` },
                { status: 409 }
              )
            }

            if (squash) {
              return Response.json({ error: "Merge conflict: " + errorMessage }, { status: 409 })
            }

            // Replicate merge in sandbox for conflict resolution
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

            return Response.json({ error: "Merge conflict: " + errorMessage }, { status: 409 })
          }
          return Response.json({ error: "Merge failed: " + errorMessage }, { status: 500 })
        }

        // Merge succeeded on GitHub
        if (isMergingIntoActiveBranch) {
          try {
            await sandbox.git.pull(repoPath, "x-access-token", githubToken)
          } catch {
            // Pull may fail but GitHub merge succeeded
          }
        }

        return Response.json({ success: true })
      }

      case "rebase": {
        if (!targetBranch || !currentBranch || !repoOwner || !repoApiName) {
          return Response.json({ error: "Missing required fields for rebase" }, { status: 400 })
        }

        // Fetch target branch from remote first to ensure we have the latest
        // This is important for single-branch clones where the target branch
        // might not exist locally or might be outdated
        const origUrlResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git remote get-url origin 2>&1`
        )
        const origUrl = origUrlResult.result.trim()
        const authedUrl = origUrl.replace(
          /^https:\/\//,
          `https://x-access-token:${githubToken}@`
        )
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git remote set-url origin '${authedUrl}' 2>&1`
        )
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git fetch origin ${targetBranch} 2>&1`
        )
        // Restore original URL
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git remote set-url origin '${origUrl}' 2>&1`
        )

        // Checkout target branch, pull latest, come back, rebase
        const coTarget = await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout ${targetBranch} 2>&1`
        )
        if (coTarget.exitCode) {
          return Response.json({ error: "Failed to checkout target: " + coTarget.result }, { status: 500 })
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
          const isConflict = rebaseResult.result.includes("CONFLICT") ||
                             rebaseResult.result.includes("could not apply")

          if (isConflict) {
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

        // Force push via GitHub API
        const shaResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git rev-parse HEAD 2>&1`
        )
        const sha = shaResult.result.trim()
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

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: unknown) {
    console.error("[sandbox/git] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
