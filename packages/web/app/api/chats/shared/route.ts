/**
 * GET /api/chats/shared → the current user's chats that have an active public
 * share link. Settings → Shared Links lists them so the user can find/copy
 * or revoke a link without having to go find the chat itself.
 */

import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"

export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    const chats = await prisma.chat.findMany({
      where: { userId: auth.userId, shareId: { not: null } },
      select: { id: true, displayName: true, shareId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    })
    return Response.json({ chats })
  } catch (error) {
    return internalError(error)
  }
}
