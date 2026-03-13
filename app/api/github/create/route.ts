import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/api-helpers"
import { createRepo } from "@/lib/github-client"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const { name, description, isPrivate } = body

  if (!name) {
    return badRequest("Missing required fields")
  }

  try {
    const data = await createRepo(auth.token, { name, description, isPrivate })
    return Response.json({
      name: data.name,
      owner: data.owner.login,
      avatar: data.owner.avatar_url,
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      private: data.private,
    })
  } catch (error: unknown) {
    return internalError(error)
  }
}
