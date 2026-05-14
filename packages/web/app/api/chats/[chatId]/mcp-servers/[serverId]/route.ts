/**
 * DELETE /api/chats/<chatId>/mcp-servers/<serverId>
 *
 * Removes the connection both from our DB and (best-effort) from Smithery.
 */
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
  getChatWithAuth,
} from "@/lib/db/api-helpers"
import { createSmitheryProvider } from "@upstream/mcp-providers"

export async function DELETE(
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
  if (!server || server.chatId !== chatId) {
    return notFound("Server not found")
  }

  try {
    const apiKey = process.env.SMITHERY_API_KEY
    if (apiKey && server.smitheryConnectionId) {
      const smithery = createSmitheryProvider({
        apiKey,
        namespace: process.env.SMITHERY_NAMESPACE,
      })
      await smithery.deleteConnection(server.smitheryConnectionId)
    }

    await prisma.chatMcpServer.delete({ where: { id: serverId } })

    return Response.json({ deleted: true })
  } catch (err) {
    return internalError(err)
  }
}
