import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  compareBranches,
  createPullRequest,
  isGitHubApiError,
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
} from "@upstream/common"
import { createGitOperationMessage } from "@/lib/db/git-messages"

/** PR description format options */
type PRDescriptionType = "short" | "long" | "commits" | "none"

/**
 * Generate PR body based on description type
 * For simple-chat, we don't use AI - just simple formatting
 */
function generatePRBodyByType(commits: string[], descriptionType: PRDescriptionType): string {
  switch (descriptionType) {
    case "none":
      return ""
    case "commits":
      return formatPRBodyFromCommits(commits)
    case "short":
      // For short, use first line of first commit or simple summary
      if (commits.length === 0) return "Automated PR"
      const firstCommit = commits[0].split("\n")[0]
      return firstCommit || "Automated PR"
    case "long":
    default:
      // For long, use full commit list with header
      if (commits.length === 0) return "Automated PR"
      return `## Changes\n\n${formatPRBodyFromCommits(commits)}`
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { owner, repo, head, base, descriptionType = "short", chatId } = body

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

    // Generate PR title and body
    const title = formatPRTitleFromBranch(head)
    const prBody = generatePRBodyByType(commitMessages, descriptionType as PRDescriptionType)

    // Create the PR
    const prData = await createPullRequest(session.accessToken, owner, repo, {
      title,
      body: prBody,
      head,
      base,
    })

    // Create success message
    if (chatId) {
      await createGitOperationMessage(
        chatId,
        `Pull request created: #${prData.number} - ${prData.title} (${prData.html_url})`,
        false,
        { action: "view-pr", prUrl: prData.html_url, prNumber: prData.number }
      )
    }

    return Response.json({
      url: prData.html_url,
      number: prData.number,
      title: prData.title,
    })
  } catch (error: unknown) {
    console.error("[github/pr] Error:", error)
    const message = isGitHubApiError(error) ? error.message : (error instanceof Error ? error.message : "Unknown error")
    const status = isGitHubApiError(error) ? error.status : 500

    if (chatId) {
      await createGitOperationMessage(chatId, `PR creation failed: ${message}`, true)
    }

    return Response.json({ error: message }, { status })
  }
}
