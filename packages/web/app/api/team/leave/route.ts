import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
} from "@/lib/shared/api-helpers"

/**
 * POST /api/team/leave - Leave the team (member only)
 */
export async function POST() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  // Find user's membership
  const membership = await prisma.teamMember.findUnique({
    where: { userId: auth.userId },
  })

  if (!membership) {
    return notFound("You are not a member of any team")
  }

  // Remove the membership
  await prisma.teamMember.delete({
    where: { id: membership.id },
  })

  return Response.json({ success: true })
}
