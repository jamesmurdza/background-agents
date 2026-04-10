import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/shared/api-helpers"
import { getRepo } from "@upstream/common"

export async function GET(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const url = new URL(req.url)
  const owner = url.searchParams.get("owner")
  const name = url.searchParams.get("name")

  if (!owner || !name) {
    return badRequest("Missing owner or name")
  }

  try {
    const data = await getRepo(auth.token, owner, name)
    return Response.json({
      name: data.name,
      owner: data.owner.login,
      avatar: data.owner.avatar_url,
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      private: data.private,
      canPush: data.permissions?.push ?? false,
    })
  } catch (error: unknown) {
    return internalError(error)
  }
}
