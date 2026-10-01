import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"
import { dispatchQueuedPrompt } from "@/lib/server/dispatch-queued-prompt"

export const maxDuration = 300

/** A browser may request a wake-up; it never chooses or starts the prompt. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  try {
    const status = await dispatchQueuedPrompt(chatId, auth.userId)
    return Response.json({ status }, { status: status === "error" ? 500 : 200 })
  } catch (error) {
    console.error(`[prompt-queue] Wake-up failed for chat ${chatId}:`, error)
    return Response.json({ error: "Failed to dispatch queued prompt" }, { status: 500 })
  }
}
