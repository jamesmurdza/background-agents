/**
 * GET /api/scheduled-jobs/<id>/mcp-servers: list the MCP servers on this job.
 * Thin wrapper around the owner-parameterized handler in lib/mcp/connections.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { listConnectionsResponse } from "@/lib/mcp/connections"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: jobId } = await params

  const resolved = await resolveMcpOwner({ kind: "job", id: jobId })
  if (!resolved.ok) return resolved.response
  return listConnectionsResponse(resolved.owner)
}
