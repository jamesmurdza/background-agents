import { requireGitHubAuth, isGitHubAuthError, badRequest, internalError } from "@/lib/shared/api-helpers"
import { createRepo } from "@upstream/common"
import { createRepoSchema, validateBody, isValidationError } from "@/lib/shared/schemas"

export async function POST(req: Request) {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  const body = await req.json()
  const validation = validateBody(body, createRepoSchema)
  if (isValidationError(validation)) {
    return badRequest(validation.error)
  }

  const { name, description, isPrivate } = validation.data

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
