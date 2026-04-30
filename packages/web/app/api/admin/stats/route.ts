import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"

/**
 * GET /api/admin/stats
 * Returns platform-wide statistics for the admin dashboard
 */
export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  // Calculate time boundaries
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - 7)

  // Run all queries in parallel for performance
  const [
    totalUsers,
    totalChats,
    activeChats,
    chatsCreatedToday,
    chatsCreatedThisWeek,
    messagesCreatedToday,
    messagesCreatedThisWeek,
    loginsToday,
    loginsThisWeek,
    modelUsageRaw,
    userGrowthRaw,
    activityByDayRaw,
    topUsersRaw,
    repoActivityRaw,
    hourlyActivityRaw,
  ] = await Promise.all([
    // Total users
    prisma.user.count(),

    // Total chats
    prisma.chat.count(),

    // Active chats (with sandbox)
    prisma.chat.count({
      where: { sandboxId: { not: null } },
    }),

    // Chats created today
    prisma.chat.count({
      where: { createdAt: { gte: startOfToday } },
    }),

    // Chats created this week
    prisma.chat.count({
      where: { createdAt: { gte: startOfWeek } },
    }),

    // Messages created today
    prisma.message.count({
      where: { createdAt: { gte: startOfToday } },
    }),

    // Messages created this week
    prisma.message.count({
      where: { createdAt: { gte: startOfWeek } },
    }),

    // Logins today (from ActivityLog)
    prisma.activityLog.count({
      where: {
        action: "login",
        createdAt: { gte: startOfToday },
      },
    }),

    // Logins this week
    prisma.activityLog.count({
      where: {
        action: "login",
        createdAt: { gte: startOfWeek },
      },
    }),

    // Model usage distribution
    prisma.chat.groupBy({
      by: ["model"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),

    // User growth over last 30 days
    prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
      FROM "User"
      WHERE "createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,

    // Activity by day for last 14 days
    prisma.$queryRaw<Array<{ date: Date; action: string; count: bigint }>>`
      SELECT DATE("createdAt") as date, action, COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days'
      GROUP BY DATE("createdAt"), action
      ORDER BY date ASC
    `,

    // Top active users (by message count in last 30 days)
    prisma.$queryRaw<Array<{ userId: string; name: string | null; image: string | null; messageCount: bigint; chatCount: bigint }>>`
      SELECT
        u.id as "userId",
        u.name,
        u.image,
        COUNT(DISTINCT m.id)::bigint as "messageCount",
        COUNT(DISTINCT c.id)::bigint as "chatCount"
      FROM "User" u
      LEFT JOIN "Chat" c ON c."userId" = u.id AND c."createdAt" >= NOW() - INTERVAL '30 days'
      LEFT JOIN "Message" m ON m."chatId" = c.id AND m."createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY u.id, u.name, u.image
      HAVING COUNT(DISTINCT m.id) > 0
      ORDER BY "messageCount" DESC
      LIMIT 10
    `,

    // Repository activity (chats per repo)
    prisma.$queryRaw<Array<{ repo: string; chatCount: bigint; messageCount: bigint }>>`
      SELECT
        c.repo,
        COUNT(DISTINCT c.id)::bigint as "chatCount",
        COUNT(DISTINCT m.id)::bigint as "messageCount"
      FROM "Chat" c
      LEFT JOIN "Message" m ON m."chatId" = c.id
      GROUP BY c.repo
      ORDER BY "chatCount" DESC
      LIMIT 10
    `,

    // Hourly activity distribution (last 14 days)
    prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT
        EXTRACT(HOUR FROM "createdAt")::int as hour,
        COUNT(*)::bigint as count
      FROM "Message"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days'
      GROUP BY hour
      ORDER BY hour ASC
    `,
  ])

  // Format model usage
  const modelUsage = modelUsageRaw.map((item) => ({
    model: item.model || "default",
    count: item._count.id,
  }))

  // Format user growth for chart
  const userGrowth = userGrowthRaw.map((item) => ({
    date: item.date.toISOString().split("T")[0],
    count: Number(item.count),
  }))

  // Format activity by day for chart
  const activityByDay = activityByDayRaw.reduce(
    (acc, item) => {
      const dateStr = item.date.toISOString().split("T")[0]
      if (!acc[dateStr]) {
        acc[dateStr] = { date: dateStr }
      }
      acc[dateStr][item.action] = Number(item.count)
      return acc
    },
    {} as Record<string, Record<string, string | number>>
  )
  const activityTrends = Object.values(activityByDay)

  // Format top users
  const topUsers = topUsersRaw.map((item) => ({
    name: item.name || "Unknown",
    image: item.image,
    messageCount: Number(item.messageCount),
    chatCount: Number(item.chatCount),
  }))

  // Format repo activity
  const repoActivity = repoActivityRaw.map((item) => ({
    repo: item.repo,
    chatCount: Number(item.chatCount),
    messageCount: Number(item.messageCount),
  }))

  // Format hourly activity
  const hourlyActivity = hourlyActivityRaw.map((item) => ({
    hour: item.hour,
    count: Number(item.count),
  }))

  return NextResponse.json({
    stats: {
      totalUsers,
      totalChats,
      activeChats,
      chatsCreatedToday,
      chatsCreatedThisWeek,
      messagesCreatedToday,
      messagesCreatedThisWeek,
      loginsToday,
      loginsThisWeek,
    },
    modelUsage,
    userGrowth,
    activityTrends,
    topUsers,
    repoActivity,
    hourlyActivity,
  })
}
