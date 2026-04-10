import { requireGitHubAuth, isGitHubAuthError, badRequest, notFound, internalError } from "@/lib/shared/api-helpers"
import { getDiff, isGitHubApiError } from "@upstream/common"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const { owner, repo, base, head, commitHash } = body

  if (!owner || !repo) {
    return badRequest("Missing required fields")
  }

  if (!commitHash && (!base || !head)) {
    return badRequest("Must provide commitHash or base+head")
  }

  try {
    const diff = await getDiff(auth.token, owner, repo, { commitHash, base, head })
    return Response.json({ diff })
  } catch (error: unknown) {
    // Handle GitHub API errors with appropriate status codes
    if (isGitHubApiError(error)) {
      // 404 - Branch or commit not found
      if (error.status === 404) {
        return notFound("Branch or commit not found")
      }
      // For "no commits between" errors (GitHub returns 404 with specific message),
      // return empty diff instead of error
      if (error.message.includes("No commits") || error.message.includes("nothing to compare")) {
        return Response.json({ diff: "" })
      }
      // Return the actual GitHub error status for other cases
      return Response.json({ error: error.message }, { status: error.status })
    }
    return internalError(error)
  }
}
