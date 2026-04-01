import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/shared/api-helpers"

/**
 * POST /api/team/members - Add a member to the team (owner only)
 * Body: { githubUsername: string }
 */
export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { githubUsername } = body

  if (!githubUsername || typeof githubUsername !== "string") {
    return badRequest("GitHub username is required")
  }

  // Find user's owned team
  const team = await prisma.team.findUnique({
    where: { ownerId: auth.userId },
  })

  if (!team) {
    return notFound("You don't own a team")
  }

  // Find the user to add by GitHub username
  const userToAdd = await prisma.user.findFirst({
    where: { githubLogin: githubUsername.replace(/^@/, "") },
  })

  if (!userToAdd) {
    return badRequest("User not found. Make sure they have signed in at least once.")
  }

  // Can't add yourself
  if (userToAdd.id === auth.userId) {
    return badRequest("You can't add yourself to your own team")
  }

  // Check if user is already in a team (as owner or member)
  const existingOwnership = await prisma.team.findUnique({
    where: { ownerId: userToAdd.id },
  })

  if (existingOwnership) {
    return badRequest("This user already owns their own team")
  }

  const existingMembership = await prisma.teamMember.findUnique({
    where: { userId: userToAdd.id },
  })

  if (existingMembership) {
    return badRequest("This user is already a member of another team")
  }

  // Add the user to the team
  const member = await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: userToAdd.id,
    },
    include: {
      user: {
        select: { id: true, name: true, githubLogin: true, image: true },
      },
    },
  })

  return Response.json({
    member: {
      id: member.user.id,
      name: member.user.name,
      githubLogin: member.user.githubLogin,
      image: member.user.image,
      joinedAt: member.createdAt,
    },
  })
}
