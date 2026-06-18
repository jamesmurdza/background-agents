/**
 * DELETE /api/scheduled-jobs/<id>/mcp-servers/<serverId>
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { disconnectResponse } from "@/lib/mcp/connections"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; serverId: string }> }
): Promise<Response> {
  const { id: jobId, serverId } = await params
  const resolved = await resolveMcpOwner("job", jobId)
  if (resolved instanceof Response) return resolved
  return disconnectResponse(resolved.owner, serverId)
}
