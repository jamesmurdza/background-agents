import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/shared/api-helpers"
import { forkRepo } from "@upstream/common"
import { forkRepoSchema, validateBody, isValidationError } from "@/lib/shared/schemas"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const validation = validateBody(body, forkRepoSchema)
  if (isValidationError(validation)) {
    return badRequest(validation.error)
  }

  const { owner, name } = validation.data

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
