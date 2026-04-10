import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/shared/api-helpers"
import { compareBranches, isGitHubApiError } from "@upstream/common"

export async function GET(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const owner = searchParams.get("owner")
  const repo = searchParams.get("repo")
  const branch = searchParams.get("branch")
  const baseBranch = searchParams.get("baseBranch")

  if (!owner || !repo || !branch || !baseBranch) {
    return badRequest("Missing required parameters")
  }

  try {
    const data = await compareBranches(auth.token, owner, repo, baseBranch, branch)

    // If ahead_by is 0, the branch has no commits that aren't in the base branch
    // This means it's fully merged
    const isMerged = data.ahead_by === 0

    return Response.json({
      isMerged,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      status: data.status // "ahead", "behind", "diverged", or "identical"
    })
  } catch (error: unknown) {
    // Branch might not exist on remote
    if (isGitHubApiError(error) && error.status === 404) {
      return Response.json({ isMerged: false, notFound: true })
    }
    return internalError(error)
  }
}
