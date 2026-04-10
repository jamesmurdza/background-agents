import { requireGitHubAuth, isGitHubAuthError, internalError } from "@/lib/shared/api-helpers"
import { getUserRepos } from "@upstream/common"

export async function GET() {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  try {
    const data = await getUserRepos(auth.token)
    const repos = data.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      avatar: r.owner.avatar_url,
      defaultBranch: r.default_branch,
      private: r.private,
      description: r.description,
      canPush: r.permissions?.push ?? false,
    }))
    return Response.json({ repos })
  } catch (error: unknown) {
    return internalError(error)
  }
}
