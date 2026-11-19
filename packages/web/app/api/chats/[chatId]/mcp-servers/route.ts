/**
 * GET /api/chats/<chatId>/mcp-servers: list the MCP servers on this chat.
 * Thin wrapper around the owner-parameterized handler in lib/mcp/connections.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { listConnectionsResponse } from "@/lib/mcp/connections"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const { chatId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return listConnectionsResponse(resolved.owner)
}
