import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
} from "@/lib/shared/api-helpers"

/**
 * GET /api/team/search?q=username - Search for users by GitHub username
 */
export async function GET(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const query = searchParams.get("q")

  if (!query || query.length < 2) {
    return badRequest("Query must be at least 2 characters")
  }

  // Search for users by GitHub username (case-insensitive)
  const users = await prisma.user.findMany({
    where: {
      githubLogin: {
        contains: query.replace(/^@/, ""),
        mode: "insensitive",
      },
      // Exclude the current user
      NOT: { id: auth.userId },
    },
    select: {
      id: true,
      name: true,
      githubLogin: true,
      image: true,
    },
    take: 10,
  })

  return Response.json({ users })
}
