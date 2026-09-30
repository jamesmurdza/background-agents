import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"
import { parseMessageRequest } from "./_lib/parse-request"
import { sendChatTurn } from "./_lib/send-turn"

export const maxDuration = 300

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  const messages = await prisma.message.findMany({
    where: { chatId }, orderBy: { timestamp: "asc" },
  })
  return Response.json({
    messages: messages.map((message) => ({ ...message, timestamp: Number(message.timestamp) })),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const parsed = await parseMessageRequest(req)
  if (parsed instanceof Response) return parsed
  return sendChatTurn({
    userId: auth.userId, chatId, payload: parsed.payload, files: parsed.files,
  })
}
