import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"

/**
 * GET /api/admin/activity
 * Returns paginated activity log entries
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 * - action: Filter by action type (optional)
 * - userId: Filter by user ID (optional)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)))
  const action = searchParams.get("action")
  const userId = searchParams.get("userId")

  const skip = (page - 1) * limit

  // Build where clause
  const where: {
    action?: string
    userId?: string
  } = {}

  if (action) where.action = action
  if (userId) where.userId = userId

  // Fetch activity logs with user info
  const [activities, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.activityLog.count({ where }),
  ])

  return NextResponse.json({
    activities: activities.map((activity) => ({
      id: activity.id,
      userId: activity.userId,
      userName: activity.user.name,
      userEmail: activity.user.email,
      userImage: activity.user.image,
      action: activity.action,
      metadata: activity.metadata,
      createdAt: activity.createdAt.toISOString(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
