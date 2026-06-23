import { compareBranches, isGitHubApiError } from "@background-agents/common"
import { requireGitHubAuth, isGitHubAuthError, internalError, badRequest } from "@/lib/db/api-helpers"

export async function POST(req: Request) {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  const body = await req.json()
  const { owner, repo, base, head } = body

  if (!owner || !repo || !base || !head) {
    return badRequest("Missing required fields: owner, repo, base, head")
  }

  try {
    const compareData = await compareBranches(ghAuth.token, owner, repo, base, head)
    return Response.json({
      ahead_by: compareData.ahead_by,
      behind_by: compareData.behind_by,
      status: compareData.status,
    })
  } catch (error: unknown) {
    console.error("[github/compare] Error:", error)
    if (isGitHubApiError(error)) {
      // For "no commits between" errors, return zero ahead
      if (error.message.includes("No commits") || error.message.includes("nothing to compare")) {
        return Response.json({ ahead_by: 0, behind_by: 0, status: "identical" })
      }
      return Response.json({ error: error.message }, { status: error.status })
    }
    return internalError(error)
  }
}
