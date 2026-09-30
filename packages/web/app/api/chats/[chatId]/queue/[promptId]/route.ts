import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; promptId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId, promptId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  const removed = await prisma.queuedPrompt.updateMany({
    where: { id: promptId, chatId, status: "queued" },
    data: { status: "cancelled" },
  })
  if (removed.count !== 1) {
    return Response.json({ error: "Prompt is not queued anymore" }, { status: 409 })
  }
  return Response.json({ removed: true })
}
