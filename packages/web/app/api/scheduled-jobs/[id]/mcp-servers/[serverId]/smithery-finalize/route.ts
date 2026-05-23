/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/<serverId>/smithery-finalize
 *
 * Polls Smithery after the OAuth popup closes and persists credentials.
 */
import { requireAuth, isAuthError, notFound } from "@/lib/db/api-helpers"
import { requireMcpOwnerAuth, type McpOwner } from "@/lib/mcp/owner"
import { finalizeSmitheryResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id: jobId, serverId } = await params

  const owner: McpOwner = { kind: "job", id: jobId }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    return notFound("Scheduled job not found")
  }
  return finalizeSmitheryResponse(owner, serverId)
}
