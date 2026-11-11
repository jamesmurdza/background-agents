/**
 * POST /api/chats/<chatId>/mcp-servers/vendor/<vendor>
 *
 * Add a sentinel row pointing at a vendor-hosted MCP server (Linear, Notion,
 * ...). The runtime loader gets an access token from the user's stored
 * McpOAuthToken.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachVendorResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; vendor: string }> }
): Promise<Response> {
  const { chatId, vendor } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return attachVendorResponse(resolved.owner, resolved.userId, vendor)
}
