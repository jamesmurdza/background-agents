import {
  compareBranches,
  createPullRequest,
  isGitHubApiError,
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
} from "@background-agents/common"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"
import { createGitOperationMessage } from "@/lib/db/git-messages"
import { generateWithOpenRouter } from "@/lib/llm/openrouter"

/** PR description format options */
type PRDescriptionType = "short" | "long" | "commits" | "none"

/** Bullet list of commit subjects, for feeding into LLM prompts. */
function commitBullets(commits: string[]): string {
  return commits.map((c) => `- ${c.split("\n")[0]}`).join("\n")
}

/**
 * Generate an AI PR title summarizing the commits. Falls back to a title derived
 * from the branch name when the LLM is unavailable.
 */
async function generatePRTitle(head: string, commits: string[]): Promise<string> {
  const fallback = formatPRTitleFromBranch(head)
  if (commits.length === 0) return fallback
  const title = await generateWithOpenRouter(
    `Write a concise, imperative-mood pull request title (max ~70 characters) summarizing these commits. Reply with only the title — no surrounding quotes, markdown, or trailing period.\n\nCommits:\n${commitBullets(commits)}`,
    { fallback }
  )
  return title.replace(/^["']|["']$/g, "").trim().slice(0, 120) || fallback
}

/**
 * Generate the PR body based on description type. "short" and "long" are
 * AI-generated summaries of the commits (with deterministic fallbacks when the
 * LLM is unavailable); "commits" and "none" are non-AI.
 */
async function generatePRBodyByType(commits: string[], descriptionType: PRDescriptionType): Promise<string> {
  switch (descriptionType) {
    case "none":
      return ""
    case "commits":
      return formatPRBodyFromCommits(commits)
    case "short": {
      const fallback = commits[0]?.split("\n")[0] || "Automated PR"
      if (commits.length === 0) return fallback
      return generateWithOpenRouter(
        `Write a short (1-2 sentence) pull request description summarizing these commits. Reply with only the description text, no markdown headings.\n\nCommits:\n${commitBullets(commits)}`,
        { fallback }
      )
    }
    case "long":
    default: {
      const fallback = commits.length > 0 ? `## Changes\n\n${formatPRBodyFromCommits(commits)}` : "Automated PR"
      if (commits.length === 0) return fallback
      return generateWithOpenRouter(
        `Write a clear pull request description in Markdown summarizing the following commits. Start with a one-sentence summary, then a "## Changes" section with a bullet list of the notable changes. Reply with only the Markdown.\n\nCommits:\n${commitBullets(commits)}`,
        { fallback }
      )
    }
  }
}

export async function POST(req: Request) {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth
  const githubToken = ghAuth.token

  const body = await req.json()
  const { owner, repo, head, base, descriptionType = "short", chatId } = body

  if (!owner || !repo || !head || !base) {
    return Response.json({ error: "Missing required fields: owner, repo, head, base" }, { status: 400 })
  }

  try {
    // Get commits between base and head for PR body
    let commitMessages: string[] = []
    try {
      const compareData = await compareBranches(githubToken, owner, repo, base, head)
      const commits = compareData.commits || []
      if (commits.length > 0) {
        commitMessages = commits.map((c) => c.commit.message)
      }
    } catch {
      // Ignore compare errors, just use empty commits
    }

    // Generate PR title and body (AI-generated with deterministic fallbacks)
    const title = await generatePRTitle(head, commitMessages)
    const prBody = await generatePRBodyByType(commitMessages, descriptionType as PRDescriptionType)

    // Create the PR
    const prData = await createPullRequest(githubToken, owner, repo, {
      title,
      body: prBody,
      head,
      base,
    })

    // Create success message
    if (chatId) {
      await createGitOperationMessage(
        chatId,
        `Pull request created: #${prData.number} - ${prData.title}.`,
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
      await createGitOperationMessage(chatId, `PR creation failed: ${message}.`, true)
    }

    return Response.json({ error: message }, { status })
  }
}
