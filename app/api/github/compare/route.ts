import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/api-helpers"
import { getDiff } from "@/lib/github-client"

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
    return internalError(error)
  }
}
