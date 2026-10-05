import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"
import { cancelQueuedPrompt } from "@/lib/server/prompt-queue"

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ chatId: string; promptId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId, promptId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  let identity: { clientId: string } | { id: string } = { id: promptId }
  const rawBody = await req.text()
  if (rawBody) {
    let body
    try { body = JSON.parse(rawBody) } catch { body = null }
    if (!body || typeof body.clientId !== "string" || !body.clientId || body.clientId.length > 128) {
      return Response.json({ error: "Invalid queue request ID" }, { status: 400 })
    }
    identity = { clientId: body.clientId }
  }
  if (!await cancelQueuedPrompt(chatId, identity)) {
    return Response.json({ error: "Prompt is not queued anymore" }, { status: 409 })
  }
  return Response.json({ removed: true })
}
