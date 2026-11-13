/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/vendor/<vendor>
 *
 * Add a sentinel row pointing at a vendor-hosted MCP server (Linear, Notion,
 * ...). The runtime loader gets an access token from the user's stored
 * McpCredential.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachVendorResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vendor: string }> }
): Promise<Response> {
  const { id: jobId, vendor } = await params

  const resolved = await resolveMcpOwner({ kind: "job", id: jobId })
  if (!resolved.ok) return resolved.response
  return attachVendorResponse(resolved.owner, resolved.userId, vendor)
}
