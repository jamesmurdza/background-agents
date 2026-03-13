import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/api-helpers"
import { getRepoBranches } from "@/lib/github-client"

export async function GET(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const owner = searchParams.get("owner")
  const repo = searchParams.get("repo")

  if (!owner || !repo) {
    return badRequest("Missing required params")
  }

  try {
    const branches = await getRepoBranches(auth.token, owner, repo)
    return Response.json({ branches })
  } catch (error: unknown) {
    return internalError(error)
  }
}
