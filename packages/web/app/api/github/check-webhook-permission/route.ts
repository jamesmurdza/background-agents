import { NextRequest } from "next/server"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"
import { hasWebhookPermission } from "@background-agents/common"

// =============================================================================
// GET - Check if user has webhook management permissions on a repo
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  const repo = req.nextUrl.searchParams.get("repo")
  if (!repo) {
    return Response.json({ error: "repo parameter required" }, { status: 400 })
  }

  const [owner, repoName] = repo.split("/")
  if (!owner || !repoName) {
    return Response.json({ error: "Invalid repo format, expected owner/repo" }, { status: 400 })
  }

  try {
    const hasPermission = await hasWebhookPermission(ghAuth.token, owner, repoName)
    return Response.json({
      hasPermission,
      needsReauth: !hasPermission,
    })
  } catch (error: unknown) {
    console.error("[github/check-webhook-permission] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
