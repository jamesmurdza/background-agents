/**
 * POST /api/chats/<chatId>/mcp-servers/paddle
 *
 * Add a sentinel row pointing at Paddle's hosted MCP. The runtime loader
 * mints fresh access tokens from the user's paddleRefreshTokenEncrypted.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachPaddleResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const { chatId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return attachPaddleResponse(resolved.owner, resolved.userId)
}
