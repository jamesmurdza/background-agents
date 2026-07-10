import { requireGitHubAuth, isGitHubAuthError, internalError } from "@/lib/db/api-helpers"
import { getUserRepos } from "@background-agents/common"
import { NextRequest } from "next/server"

const PER_PAGE = 100

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))

  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) {
    // Log *why* auth failed (status + error body) so a 401 in prod can be told
    // apart: "Unauthorized" (no/expired session) vs "GitHub account not linked"
    // (missing stored token). No userId is logged.
    const reason = await ghAuth
      .clone()
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => undefined)
    console.warn(
      `[github/repos] auth failed: status=${ghAuth.status} reason=${reason ?? "unknown"} page=${page}`
    )
    return ghAuth
  }

  try {
    const start = Date.now()
    const repos = await getUserRepos(ghAuth.token, {
      sort: "updated",
      perPage: PER_PAGE,
      page,
      affiliation: "owner,collaborator,organization_member",
    })

    // If we got fewer repos than PER_PAGE, this is the last page
    const hasMore = repos.length === PER_PAGE

    // Track pagination so a runaway "load all pages" loop (e.g. a user in many
    // large orgs) is visible: watch for the page number climbing while hasMore
    // stays true.
    console.log(
      `[github/repos] ok page=${page} count=${repos.length} hasMore=${hasMore} ms=${Date.now() - start}`
    )

    return Response.json({ repos, page, hasMore })
  } catch (error: unknown) {
    // getUserRepos throwing means GitHub rejected the token (e.g. revoked ->
    // 401 from GitHub, surfaced here as a 500) or rate-limited us.
    console.error(`[github/repos] Error page=${page}:`, error)
    return internalError(error)
  }
}
