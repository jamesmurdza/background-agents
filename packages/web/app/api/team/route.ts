import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/shared/api-helpers"

/**
 * GET /api/team - Get current user's team info
 */
export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  // Check if user owns a team
  const ownedTeam = await prisma.team.findUnique({
    where: { ownerId: auth.userId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, githubLogin: true, image: true },
          },
        },
      },
    },
  })

  if (ownedTeam) {
    return Response.json({
      team: {
        id: ownedTeam.id,
        isOwner: true,
        members: ownedTeam.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          githubLogin: m.user.githubLogin,
          image: m.user.image,
          joinedAt: m.createdAt,
        })),
      },
    })
  }

  // Check if user is a team member
  const membership = await prisma.teamMember.findUnique({
    where: { userId: auth.userId },
    include: {
      team: {
        include: {
          owner: {
            select: { id: true, name: true, githubLogin: true, image: true },
          },
        },
      },
    },
  })

  if (membership) {
    return Response.json({
      team: {
        id: membership.team.id,
        isOwner: false,
        owner: {
          id: membership.team.owner.id,
          name: membership.team.owner.name,
          githubLogin: membership.team.owner.githubLogin,
          image: membership.team.owner.image,
        },
      },
    })
  }

  return Response.json({ team: null })
}

/**
 * POST /api/team - Create a new team (user becomes owner)
 */
export async function POST() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  // Check if user already owns a team
  const existingTeam = await prisma.team.findUnique({
    where: { ownerId: auth.userId },
  })

  if (existingTeam) {
    return badRequest("You already own a team")
  }

  // Check if user is already a member of another team
  const existingMembership = await prisma.teamMember.findUnique({
    where: { userId: auth.userId },
  })

  if (existingMembership) {
    return badRequest("You are already a member of another team. Leave that team first.")
  }

  // Create the team
  const team = await prisma.team.create({
    data: {
      ownerId: auth.userId,
    },
  })

  return Response.json({
    team: {
      id: team.id,
      isOwner: true,
      members: [],
    },
  })
}

/**
 * DELETE /api/team - Delete the team (owner only)
 */
export async function DELETE() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  // Find user's owned team
  const team = await prisma.team.findUnique({
    where: { ownerId: auth.userId },
  })

  if (!team) {
    return notFound("You don't own a team")
  }

  // Delete the team (cascade will delete all members)
  await prisma.team.delete({
    where: { id: team.id },
  })

  return Response.json({ success: true })
}
