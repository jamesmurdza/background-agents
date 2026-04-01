import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/shared/api-helpers"

/**
 * DELETE /api/team/members/[userId] - Remove a member from the team (owner only)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const { userId: memberUserId } = await params

  if (!memberUserId) {
    return badRequest("User ID is required")
  }

  // Find user's owned team
  const team = await prisma.team.findUnique({
    where: { ownerId: auth.userId },
  })

  if (!team) {
    return notFound("You don't own a team")
  }

  // Find the membership
  const membership = await prisma.teamMember.findFirst({
    where: {
      teamId: team.id,
      userId: memberUserId,
    },
  })

  if (!membership) {
    return notFound("User is not a member of your team")
  }

  // Remove the member
  await prisma.teamMember.delete({
    where: { id: membership.id },
  })

  return Response.json({ success: true })
}
