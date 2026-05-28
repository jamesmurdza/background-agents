import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"
import { getRepo } from "@background-agents/common"

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
    const repoData = await getRepo(ghAuth.token, owner, repo)
    return Response.json({ repo: repoData })
  } catch (error: unknown) {
    console.error("[github/repo] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
