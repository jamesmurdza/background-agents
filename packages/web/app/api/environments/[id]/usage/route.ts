import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, notFound, internalError } from "@/lib/db/api-helpers"
import { getOwnedEnvironment } from "@/lib/environments"

/**
 * How many of the user's chats are pinned to this environment. Drives the
 * delete confirmation copy ("3 chats use this environment and will fall back
 * to Default"), so a deletion is never silent about its blast radius.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const exists = await getOwnedEnvironment(userId, id)
    if (!exists) return notFound("Environment not found")

    const chatCount = await prisma.chat.count({ where: { userId, environmentId: id } })
    return Response.json({ chatCount })
  } catch (error) {
    return internalError(error)
  }
}
