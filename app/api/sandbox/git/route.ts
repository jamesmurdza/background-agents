import { Daytona } from "@daytonaio/sdk"

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const { daytonaApiKey, sandboxId, repoPath, action, githubPat, targetBranch, currentBranch } = body

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
        // Use process to get git log since SDK may not expose getCommitHistory directly
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
        return Response.json({ commits })
      }

      case "auto-commit-push": {
        if (!githubPat) {
          return Response.json({ error: "GitHub PAT required for push" }, { status: 400 })
        }
        // Check for uncommitted changes
        const statusResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git status --porcelain 2>&1`
        )
        if (statusResult.exitCode || !statusResult.result.trim()) {
          return Response.json({ committed: false, pushed: false })
        }
        // Commit all changes
        const commitResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git add -A && git commit -m "Auto-commit: agent changes" 2>&1`
        )
        if (commitResult.exitCode) {
          return Response.json({ error: "Commit failed: " + commitResult.result }, { status: 500 })
        }
        // Push via Daytona SDK (PAT never enters sandbox)
        await sandbox.git.push(repoPath, "x-access-token", githubPat)
        return Response.json({ committed: true, pushed: true })
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

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
