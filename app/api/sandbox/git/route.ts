import { Daytona } from "@daytonaio/sdk"

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const { daytonaApiKey, sandboxId, repoPath, action, githubPat, targetBranch, currentBranch, repoOwner, repoApiName, tagName } = body

  if (!daytonaApiKey || !sandboxId || !repoPath || !action) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    switch (action) {
      case "status": {
        const status = await sandbox.git.status(repoPath)
        return Response.json(status)
      }

      case "log": {
        const result = await sandbox.process.executeCommand(
          `cd ${repoPath} && git log --format='{"hash":"%H","shortHash":"%h","author":"%an","email":"%ae","message":"%s","timestamp":"%aI"}' -30 2>&1`
        )
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
        if (!githubPat) {
          return Response.json({ error: "GitHub PAT required for push" }, { status: 400 })
        }
        // Check for uncommitted changes and commit them if any
        let committed = false
        const statusResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git status --porcelain 2>&1`
        )
        if (!statusResult.exitCode && statusResult.result.trim()) {
          const commitResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git add -A && git commit -m "Auto-commit: agent changes" 2>&1`
          )
          if (commitResult.exitCode) {
            return Response.json({ error: "Commit failed: " + commitResult.result }, { status: 500 })
          }
          committed = true
        }
        // Always push — covers agent-made commits AND new branches with no upstream.
        // Daytona SDK push is safe to call even if there's nothing new to push.
        await sandbox.git.push(repoPath, "x-access-token", githubPat)
        return Response.json({ committed, pushed: true })
      }

      case "push": {
        if (!githubPat) {
          return Response.json({ error: "GitHub PAT required for push" }, { status: 400 })
        }
        await sandbox.git.push(repoPath, "x-access-token", githubPat)
        return Response.json({ success: true })
      }

      case "pull": {
        if (!githubPat) {
          return Response.json({ error: "GitHub PAT required for pull" }, { status: 400 })
        }
        await sandbox.git.pull(repoPath, "x-access-token", githubPat)
        return Response.json({ success: true })
      }

      case "list-branches": {
        // Fetch all remote branches first (single-branch clones only see origin/main)
        if (githubPat) {
          const origUrlResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git remote get-url origin 2>&1`
          )
          const origUrl = origUrlResult.result.trim()
          // Temporarily set authed URL for private repos
          const authedUrl = origUrl.replace(
            /^https:\/\//,
            `https://x-access-token:${githubPat}@`
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
        if (!githubPat || !targetBranch || !currentBranch) {
          return Response.json({ error: "Missing required fields for merge" }, { status: 400 })
        }
        // Checkout target branch
        const coTarget = await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout ${targetBranch} 2>&1`
        )
        if (coTarget.exitCode) {
          return Response.json({ error: "Failed to checkout target: " + coTarget.result }, { status: 500 })
        }
        // Pull latest on target via Daytona SDK
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubPat)
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
          await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
          return Response.json({ error: "Merge conflict: " + mergeResult.result }, { status: 409 })
        }
        // Push the merged target
        await sandbox.git.push(repoPath, "x-access-token", githubPat)
        // Switch back to current branch
        await sandbox.process.executeCommand(`cd ${repoPath} && git checkout ${currentBranch} 2>&1`)
        return Response.json({ success: true })
      }

      case "rebase": {
        if (!githubPat || !targetBranch || !currentBranch || !repoOwner || !repoApiName) {
          return Response.json({ error: "Missing required fields for rebase" }, { status: 400 })
        }
        // Checkout target branch, pull latest, come back, rebase
        const coTarget2 = await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout ${targetBranch} 2>&1`
        )
        if (coTarget2.exitCode) {
          return Response.json({ error: "Failed to checkout target: " + coTarget2.result }, { status: 500 })
        }
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubPat)
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
              Authorization: `Bearer ${githubPat}`,
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
        if (!githubPat || !tagName || !repoOwner || !repoApiName) {
          return Response.json({ error: "Missing required fields for tag" }, { status: 400 })
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
              Authorization: `Bearer ${githubPat}`,
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

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
