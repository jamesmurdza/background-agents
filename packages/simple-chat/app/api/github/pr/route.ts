import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  compareBranches,
  createPullRequest,
  isGitHubApiError,
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
} from "@upstream/common"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { owner, repo, head, base } = body

  if (!owner || !repo || !head || !base) {
    return Response.json({ error: "Missing required fields: owner, repo, head, base" }, { status: 400 })
  }

  try {
    // Get commits between base and head for PR body
    let commitMessages: string[] = []
    try {
      const compareData = await compareBranches(session.accessToken, owner, repo, base, head)
      const commits = compareData.commits || []
      if (commits.length > 0) {
        commitMessages = commits.map((c) => c.commit.message)
      }
    } catch {
      // Ignore compare errors, just use empty commits
    }

    // Generate PR title and body using shared utilities
    const title = formatPRTitleFromBranch(head)
    const prBody = formatPRBodyFromCommits(commitMessages)

    // Create the PR
    const prData = await createPullRequest(session.accessToken, owner, repo, {
      title,
      body: prBody,
      head,
      base,
    })

    return Response.json({
      url: prData.html_url,
      number: prData.number,
      title: prData.title,
    })
  } catch (error: unknown) {
    console.error("[github/pr] Error:", error)
    if (isGitHubApiError(error)) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
