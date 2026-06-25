import { randomBytes } from "crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// POST /api/chats/[chatId]/share — enable (or return existing) public share
// =============================================================================
//
// Generates an unguessable shareId so the chat is viewable read-only at
// /share/<shareId> without auth. Idempotent: if already shared, returns the
// existing token.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    let shareId = chat.shareId
    if (!shareId) {
      // 32 hex chars (~128 bits) — long and unguessable.
      shareId = randomBytes(16).toString("hex")
      await prisma.chat.update({
        where: { id: chatId },
        data: { shareId },
      })
    }

    return Response.json({ shareId })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// DELETE /api/chats/[chatId]/share — revoke the public share
// =============================================================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    if (chat.shareId) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { shareId: null },
      })
    }

    return Response.json({ shareId: null })
  } catch (error) {
    return internalError(error)
  }
}
