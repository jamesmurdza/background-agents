/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/<serverId>/smithery-finalize
 *
 * Polls Smithery after the OAuth popup closes and persists credentials.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { finalizeSmitheryResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const { id: jobId, serverId } = await params
  const resolved = await resolveMcpOwner("job", jobId)
  if (resolved instanceof Response) return resolved
  return finalizeSmitheryResponse(resolved.owner, serverId)
}
