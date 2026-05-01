import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"

/**
 * GET /api/admin/users
 * Returns paginated user list with stats
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - search: Search by name, email, or GitHub ID (optional)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)))
  const search = searchParams.get("search")

  const skip = (page - 1) * limit

  // Build where clause for search
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { githubId: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}

  // Fetch users
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        githubId: true,
        isAdmin: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ])

  // Get chat counts (only chats with messages)
  const userIds = users.map((u) => u.id)
  const chatCounts = await prisma.$queryRaw<Array<{ userId: string; count: bigint }>>`
    SELECT c."userId", COUNT(DISTINCT c.id)::bigint as count
    FROM "Chat" c
    INNER JOIN "Message" m ON m."chatId" = c.id
    WHERE c."userId" = ANY(${userIds})
    GROUP BY c."userId"
  `
  const chatCountMap = new Map(chatCounts.map((c) => [c.userId, Number(c.count)]))

  // Get last activity for each user
  const lastActivities = await prisma.activityLog.findMany({
    where: { userId: { in: userIds } },
    orderBy: { createdAt: "desc" },
    distinct: ["userId"],
    select: {
      userId: true,
      createdAt: true,
      action: true,
    },
  })

  const lastActivityMap = new Map(
    lastActivities.map((a) => [a.userId, { createdAt: a.createdAt, action: a.action }])
  )

  return NextResponse.json({
    users: users.map((user) => {
      const lastActivity = lastActivityMap.get(user.id)
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        githubId: user.githubId,
        isAdmin: user.isAdmin,
        totalChats: chatCountMap.get(user.id) ?? 0,
        lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
        lastActivityAction: lastActivity?.action ?? null,
        createdAt: user.createdAt.toISOString(),
      }
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
