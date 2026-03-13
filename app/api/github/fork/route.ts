import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/api-helpers"
import { forkRepo } from "@/lib/github-client"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const { owner, name } = body

  if (!owner || !name) {
    return badRequest("Missing required fields")
  }

  try {
    const data = await forkRepo(auth.token, owner, name)
    return Response.json({
      name: data.name,
      owner: data.owner.login,
      avatar: data.owner.avatar_url,
      defaultBranch: data.default_branch,
      fullName: data.full_name,
    })
  } catch (error: unknown) {
    return internalError(error)
  }
}
