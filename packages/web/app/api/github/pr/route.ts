import { prisma } from "@/lib/db/prisma"
import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/shared/api-helpers"
import { compareBranches, createPullRequest, isGitHubApiError } from "@upstream/common"
import { createPRSchema, validateBody, isValidationError } from "@/lib/shared/schemas"
import { generateWithUserLLM } from "@/lib/llm/llm"

const PR_TITLE_PROMPT = `Based on the branch name and commit messages below, generate a concise pull request title.

Requirements:
- Keep it under 72 characters
- Use sentence case (capitalize first letter only)
- Focus on WHAT the PR accomplishes, not HOW
- Do not include PR number or branch name prefixes like "feat:" or "fix:"
- Make it descriptive but concise
- Do not include any quotes around the title

Branch name: {branchName}

Commit messages:
{commits}

Reply with ONLY the PR title, nothing else. Examples:
Add dark mode toggle to settings page
Fix authentication timeout on slow connections
Refactor API client for better error handling`

const PR_BODY_PROMPT = `Based on the commit messages below, generate a clear and helpful pull request description.

Requirements:
- Start with a brief summary (1-2 sentences) of what this PR accomplishes
- Include a "## Changes" section with bullet points summarizing the key changes
- Keep it concise but informative
- Use markdown formatting
- Do not include a title or PR number
- Do not make up details not evident from the commits

Commit messages:
{commits}

Reply with ONLY the PR description in markdown format.`

/**
 * Generate a PR title using AI, with fallback to simple branch name formatting
 */
async function generatePRTitle(
  userId: string,
  branchName: string,
  commits: string[]
): Promise<string> {
  // Always have a fallback title from branch name
  const fallbackTitle = branchName
    .replace(/^(feat|fix|refactor|docs|test|chore)\//, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase())

  // If no commits, just use fallback
  if (commits.length === 0) {
    return fallbackTitle
  }

  const prompt = PR_TITLE_PROMPT
    .replace("{branchName}", branchName)
    .replace("{commits}", commits.map((c) => `- ${c}`).join("\n"))

  try {
    const result = await generateWithUserLLM({ userId, prompt })

    if (result.error || !result.text) {
      console.log("[generatePRTitle] AI generation failed, using fallback:", result.error)
      return fallbackTitle
    }

    // Sanitize the AI-generated title
    const sanitizedTitle = result.text
      .replace(/^["'`]|["'`]$/g, "") // Remove quotes
      .replace(/`/g, "") // Remove backticks
      .split("\n")[0] // Take first line only
      .trim()
      .slice(0, 72) // Limit length

    return sanitizedTitle || fallbackTitle
  } catch (error) {
    console.error("[generatePRTitle] Error:", error)
    return fallbackTitle
  }
}

/**
 * Generate a PR body/description using AI, with fallback to simple commit list
 */
async function generatePRBody(
  userId: string,
  commits: string[]
): Promise<string> {
  // Always have a fallback body from commit messages
  const fallbackBody = commits.length > 0
    ? commits.map((c) => `- ${c}`).join("\n")
    : "Automated PR"

  // If no commits, just use fallback
  if (commits.length === 0) {
    return fallbackBody
  }

  const prompt = PR_BODY_PROMPT
    .replace("{commits}", commits.map((c) => `- ${c}`).join("\n"))

  try {
    const result = await generateWithUserLLM({ userId, prompt })

    if (result.error || !result.text) {
      console.log("[generatePRBody] AI generation failed, using fallback:", result.error)
      return fallbackBody
    }

    // Basic sanitization - trim and ensure it's not empty
    const sanitizedBody = result.text.trim()

    return sanitizedBody || fallbackBody
  } catch (error) {
    console.error("[generatePRBody] Error:", error)
    return fallbackBody
  }
}

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const validation = validateBody(body, createPRSchema)
  if (isValidationError(validation)) {
    return badRequest(validation.error)
  }

  const { owner, repo, head, base } = validation.data

  try {
    // Get commits between base and head for PR body and title generation
    let commitMessages: string[] = []
    try {
      const compareData = await compareBranches(auth.token, owner, repo, base, head)
      const commits = compareData.commits || []
      if (commits.length > 0) {
        commitMessages = commits.map((c) => c.commit.message)
      }
    } catch {
      // Ignore compare errors, just use empty commits
    }

    // Generate AI-powered PR title and body (falls back to simple formatting)
    // Run both in parallel for better performance
    const [title, prBody] = await Promise.all([
      generatePRTitle(auth.userId, head, commitMessages),
      generatePRBody(auth.userId, commitMessages),
    ])

    // Create the PR
    const prData = await createPullRequest(auth.token, owner, repo, {
      title,
      body: prBody || "Automated PR",
      head,
      base,
    })

    // Update branch with PR URL
    const branchRecord = await prisma.branch.findFirst({
      where: {
        name: head,
        repo: {
          owner,
          name: repo,
          userId: auth.userId,
        },
      },
    })
    if (branchRecord) {
      await prisma.branch.update({
        where: { id: branchRecord.id },
        data: { prUrl: prData.html_url },
      })
    }

    return Response.json({
      url: prData.html_url,
      number: prData.number,
      title: prData.title,
    })
  } catch (error: unknown) {
    if (isGitHubApiError(error)) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return internalError(error)
  }
}
