import { prisma } from "@/lib/prisma"
import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/api-helpers"
import { compareBranches, createPullRequest, isGitHubApiError } from "@/lib/github-client"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const { owner, repo, head, base } = body

  if (!owner || !repo || !head || !base) {
    return badRequest("Missing required fields")
  }

  try {
    // Get commits between base and head for PR body
    let prBody = ""
    try {
      const compareData = await compareBranches(auth.token, owner, repo, base, head)
      const commits = compareData.commits || []
      if (commits.length > 0) {
        prBody = commits
          .map((c) => `- ${c.commit.message}`)
          .join("\n")
      }
    } catch {
      // Ignore compare errors, just use empty body
    }

    // Generate title from branch name
    const title = head
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase())

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
