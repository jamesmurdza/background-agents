/**
 * POST /api/chats/<chatId>/mcp-servers/<serverId>/smithery-finalize
 *
 * Called by the client after the Smithery OAuth popup closes. Polls Smithery
 * for `connected` state and persists the credentials on success.
 *
 * Returns { connected: true } on success, 400 otherwise so the modal can show
 * a "try again" message.
 */
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  serverConfigError,
  internalError,
  getChatWithAuth,
} from "@/lib/db/api-helpers"
import { finalizeSmitheryConnection } from "@/lib/mcp/smithery-connect"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; serverId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId, serverId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  const server = await prisma.chatMcpServer.findUnique({
    where: { id: serverId },
  })
  if (!server || server.chatId !== chatId) return notFound("Server not found")

  if (!server.smitheryConnectionId) {
    return badRequest("Server has no Smithery connection id")
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  try {
    const ok = await finalizeSmitheryConnection(
      serverId,
      server.smitheryConnectionId,
      apiKey
    )
    if (ok) return Response.json({ connected: true })
    return Response.json(
      { error: "Connection not yet authorized. Please try again." },
      { status: 400 }
    )
  } catch (err) {
    return internalError(err)
  }
}
