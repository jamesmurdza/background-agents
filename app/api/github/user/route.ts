import { requireGitHubAuth, isGitHubAuthError, internalError } from "@/lib/api-helpers"
import { getUser } from "@/lib/github-client"

export async function GET() {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  try {
    const data = await getUser(auth.token)
    return Response.json({
      login: data.login,
      avatar: data.avatar_url,
      name: data.name,
    })
  } catch (error: unknown) {
    return internalError(error)
  }
}
