import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { compareBranches, githubFetch, isGitHubApiError } from "@upstream/common"
import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { createGitOperationMessage } from "@/lib/db/git-messages"

// Squash operation timeout - 60 seconds
export const maxDuration = 60

interface SquashRequestBody {
  owner: string
  repo: string
  head: string  // current branch to squash
  base: string  // base branch to squash relative to
  sandboxId: string
  chatId?: string
}

/**
 * POST /api/github/squash
 *
 * Squashes all commits on the head branch that are ahead of base into a single commit.
 * Uses GitHub API to perform the squash merge via a temp branch, then syncs the sandbox.
 *
 * Steps:
 * 1. Create a temp branch from base on GitHub
 * 2. Squash merge head into temp branch via GitHub API (using PR merge)
 * 3. Update head branch ref to point to the squashed commit
 * 4. Delete temp branch
 * 5. Sync sandbox with git fetch + reset
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body: SquashRequestBody = await req.json()
  const { owner, repo, head, base, sandboxId, chatId } = body

  if (!owner || !repo || !head || !base || !sandboxId) {
    return Response.json({ error: "Missing required fields: owner, repo, head, base, sandboxId" }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    // First, verify there are commits to squash
    const compareData = await compareBranches(session.accessToken, owner, repo, base, head)
    if (compareData.ahead_by < 2) {
      return Response.json({
        error: `Need at least 2 commits to squash. Branch "${head}" is only ${compareData.ahead_by} commit(s) ahead of "${base}".`
      }, { status: 400 })
    }

    // Get the base branch SHA
    const baseRef = await githubFetch<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/refs/heads/${base}`,
      session.accessToken
    )
    const baseSha = baseRef.object.sha

    // Step 1: Create a temp branch from base
    const tempBranchName = `_squash-temp-${Date.now()}`
    await githubFetch(
      `/repos/${owner}/${repo}/git/refs`,
      session.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${tempBranchName}`,
          sha: baseSha,
        }),
      }
    )

    try {
      // Step 2: Create a temporary PR and squash merge it
      const pr = await githubFetch<{ number: number; head: { sha: string } }>(
        `/repos/${owner}/${repo}/pulls`,
        session.accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            title: `Squash ${head}`,
            head: head,
            base: tempBranchName,
            body: "Temporary PR for squash operation",
          }),
        }
      )

      // Merge the PR with squash
      // GitHub needs time to verify mergeability after PR creation, so we retry on "Base branch was modified" error
      let mergeResult: { sha: string; merged: boolean } | null = null
      let lastError: Error | null = null

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Wait a bit before merge to let GitHub's mergeability check complete
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          }

          mergeResult = await githubFetch<{ sha: string; merged: boolean }>(
            `/repos/${owner}/${repo}/pulls/${pr.number}/merge`,
            session.accessToken,
            {
              method: "PUT",
              body: JSON.stringify({
                merge_method: "squash",
                commit_title: `Squashed ${compareData.ahead_by} commits from ${head}`,
              }),
            }
          )
          break // Success, exit retry loop
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          // Only retry on "Base branch was modified" error
          if (!lastError.message.includes("Base branch was modified")) {
            throw err
          }
          console.log(`[squash] Merge attempt ${attempt + 1} failed with "Base branch was modified", retrying...`)
        }
      }

      if (!mergeResult) {
        throw lastError || new Error("Squash merge failed after retries")
      }

      if (!mergeResult.merged) {
        throw new Error("Squash merge failed")
      }

      // Get the new squashed commit SHA from the temp branch
      const tempRef = await githubFetch<{ object: { sha: string } }>(
        `/repos/${owner}/${repo}/git/refs/heads/${tempBranchName}`,
        session.accessToken
      )
      const squashedSha = tempRef.object.sha

      // Step 3: Update head branch to point to the squashed commit
      await githubFetch(
        `/repos/${owner}/${repo}/git/refs/heads/${head}`,
        session.accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({
            sha: squashedSha,
            force: true,
          }),
        }
      )

      // Step 4: Delete temp branch (cleanup)
      try {
        await githubFetch(
          `/repos/${owner}/${repo}/git/refs/heads/${tempBranchName}`,
          session.accessToken,
          { method: "DELETE" }
        )
      } catch {
        // Best effort cleanup - don't fail the whole operation
        console.warn(`Failed to delete temp branch ${tempBranchName}`)
      }

      // Step 5: Sync sandbox with the new squashed state
      try {
        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.get(sandboxId)
        const repoPath = `${PATHS.SANDBOX_HOME}/project`

        // Fetch the latest from origin
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git fetch origin ${head} 2>&1`
        )

        // Ensure we're on the correct branch before resetting
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout ${head} 2>&1`
        )

        // Reset local branch to match the squashed remote
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git reset --hard origin/${head} 2>&1`
        )
      } catch (sandboxErr) {
        // Squash succeeded on GitHub, but sandbox sync failed
        // Return success with a warning
        console.warn("Sandbox sync failed after squash:", sandboxErr)
        return Response.json({
          success: true,
          warning: "Squash completed on GitHub but sandbox sync failed. Try pulling manually.",
          squashedSha,
          commitsSquashed: compareData.ahead_by,
        })
      }

      // Create success message
      if (chatId) {
        await createGitOperationMessage(
          chatId,
          `Squashed ${compareData.ahead_by} commits into one on ${head}.`
        )
      }

      return Response.json({
        success: true,
        squashedSha,
        commitsSquashed: compareData.ahead_by,
      })

    } catch (err) {
      // Cleanup: try to delete temp branch if it was created
      try {
        await githubFetch(
          `/repos/${owner}/${repo}/git/refs/heads/${tempBranchName}`,
          session.accessToken,
          { method: "DELETE" }
        )
      } catch {
        // Ignore cleanup errors
      }
      throw err
    }

  } catch (error: unknown) {
    console.error("[github/squash] Error:", error)
    const message = isGitHubApiError(error) ? error.message : (error instanceof Error ? error.message : "Unknown error")
    const status = isGitHubApiError(error) ? error.status : 500

    if (chatId) {
      await createGitOperationMessage(chatId, `Squash failed: ${message}`, true)
    }

    return Response.json({ error: message }, { status })
  }
}
