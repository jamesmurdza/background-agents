/**
 * POST /api/chats/<chatId>/mcp-servers/github
 *
 * Add a sentinel ChatMcpServer row that points at GitHub's hosted MCP
 * (api.githubcopilot.com/mcp/). No Smithery involved — the agent-side
 * loader detects the sentinel qualifiedName and mints a fresh installation
 * token on every turn.
 *
 * Requires the user to have completed the GitHub App install first
 * (User.githubAppInstallationId must be set).
 */
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
  getChatWithAuth,
} from "@/lib/db/api-helpers"
import { GITHUB_MCP_QUALIFIED_NAME, GITHUB_MCP_URL } from "@upstream/mcp-providers"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })
  if (!user?.githubAppInstallationId) {
    return Response.json(
      { error: "GitHub App not installed for this user" },
      { status: 409 }
    )
  }

  try {
    const { id: serverId } = await prisma.chatMcpServer.upsert({
      where: {
        chatId_qualifiedName: {
          chatId,
          qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
        },
      },
      create: {
        chatId,
        qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
        displayName: "GitHub",
        iconUrl: null,
        mcpUrl: GITHUB_MCP_URL,
        status: "connected",
      },
      update: {
        status: "connected",
        lastError: null,
      },
      select: { id: true },
    })
    return Response.json({ connected: true, serverId })
  } catch (err) {
    return internalError(err)
  }
}
