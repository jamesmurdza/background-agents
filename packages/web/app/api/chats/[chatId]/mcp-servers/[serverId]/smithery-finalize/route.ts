/**
 * POST /api/chats/<chatId>/mcp-servers/<serverId>/smithery-finalize
 *
 * Polls Smithery after the OAuth popup closes and persists credentials.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { finalizeSmitheryResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const { chatId, serverId } = await params
  const resolved = await resolveMcpOwner("chat", chatId)
  if (resolved instanceof Response) return resolved
  return finalizeSmitheryResponse(resolved.owner, serverId)
}
