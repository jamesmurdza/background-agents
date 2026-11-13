/**
 * POST /api/chats/<chatId>/mcp-servers/github
 *
 * Add a sentinel row pointing at GitHub's hosted MCP. The runtime loader
 * mints fresh installation tokens from the user's GitHub McpCredential.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachGithubResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const { chatId } = await params

  const resolved = await resolveMcpOwner({ kind: "chat", id: chatId })
  if (!resolved.ok) return resolved.response
  return attachGithubResponse(resolved.owner, resolved.userId)
}
