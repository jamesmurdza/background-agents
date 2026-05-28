import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"
import { getUserRepos } from "@background-agents/common"
import { NextRequest } from "next/server"

const PER_PAGE = 100

export async function GET(request: NextRequest) {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))

  try {
    const repos = await getUserRepos(ghAuth.token, {
      sort: "updated",
      perPage: PER_PAGE,
      page,
      affiliation: "owner,collaborator,organization_member",
    })

    // If we got fewer repos than PER_PAGE, this is the last page
    const hasMore = repos.length === PER_PAGE

    return Response.json({ repos, page, hasMore })
  } catch (error: unknown) {
    console.error("[github/repos] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
