import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getRangeInterval, parseFiniteTimeRange } from "@/lib/db/time-range"

/**
 * GET /api/admin/top-users
 * Returns top active users for a given time range
 *
 * Query params:
 * - range: Time range - "24h", "7d", or "30d" (default: "30d")
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const searchParams = request.nextUrl.searchParams
  const range = parseFiniteTimeRange(searchParams.get("range"), "30d")
  const interval = getRangeInterval(range)

  // Top active users (by message count in the given time range) - from ActivityLog to include deleted
  const topUsersRaw = await prisma.$queryRaw<
    Array<{
      userId: string
      name: string | null
      image: string | null
      messageCount: bigint
      chatCount: bigint
    }>
  >`
    SELECT
      u.id as "userId",
      u.name,
      u.image,
      COALESCE(m.count, 0)::bigint as "messageCount",
      COALESCE(c.count, 0)::bigint as "chatCount"
    FROM "User" u
    LEFT JOIN (
      SELECT "userId", COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE action = 'message_sent' AND "createdAt" >= NOW() - ${interval}::interval
      GROUP BY "userId"
    ) m ON m."userId" = u.id
    LEFT JOIN (
      SELECT "userId", COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE action = 'chat_created' AND "createdAt" >= NOW() - ${interval}::interval
      GROUP BY "userId"
    ) c ON c."userId" = u.id
    WHERE COALESCE(m.count, 0) > 0
    ORDER BY "messageCount" DESC
    LIMIT 10
  `

  const topUsers = topUsersRaw.map((item) => ({
    name: item.name || "Unknown",
    image: item.image,
    messageCount: Number(item.messageCount),
    chatCount: Number(item.chatCount),
  }))

  return NextResponse.json({ topUsers })
}
