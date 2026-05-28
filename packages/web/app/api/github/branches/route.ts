import { getRepoBranches } from "@background-agents/common"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"

export async function GET(req: Request) {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  const { searchParams } = new URL(req.url)
  const owner = searchParams.get("owner")
  const repo = searchParams.get("repo")

  if (!owner || !repo) {
    return Response.json({ error: "Missing required params: owner, repo" }, { status: 400 })
  }

  try {
    const branches = await getRepoBranches(ghAuth.token, owner, repo)
    return Response.json({ branches })
  } catch (error: unknown) {
    console.error("[github/branches] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
