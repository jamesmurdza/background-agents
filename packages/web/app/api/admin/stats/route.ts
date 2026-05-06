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
    dailyMessagesChatsRaw,
    messagesByModelRaw,
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

    // Weekly active users (WAU) - for each of the last 30 days, count unique users active in the preceding 7 days
    prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT d.date, COUNT(DISTINCT a."userId")::bigint as count
      FROM (
        SELECT generate_series(
          (NOW() - INTERVAL '30 days')::date,
          NOW()::date,
          '1 day'::interval
        )::date as date
      ) d
      LEFT JOIN "ActivityLog" a ON a."createdAt" >= d.date - INTERVAL '6 days' AND a."createdAt" < d.date + INTERVAL '1 day'
      GROUP BY d.date
      ORDER BY d.date ASC
    `,

    // Activity by day for last 14 days
    prisma.$queryRaw<Array<{ date: Date; action: string; count: bigint }>>`
      SELECT DATE("createdAt") as date, action, COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days'
      GROUP BY DATE("createdAt"), action
      ORDER BY date ASC
    `,

    // Top active users (by message count in last 30 days) - from ActivityLog to include deleted
    prisma.$queryRaw<Array<{ userId: string; name: string | null; image: string | null; messageCount: bigint; chatCount: bigint }>>`
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
        WHERE action = 'message_sent' AND "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY "userId"
      ) m ON m."userId" = u.id
      LEFT JOIN (
        SELECT "userId", COUNT(*)::bigint as count
        FROM "ActivityLog"
        WHERE action = 'chat_created' AND "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY "userId"
      ) c ON c."userId" = u.id
      WHERE COALESCE(m.count, 0) > 0
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

    // Hourly activity distribution (last 14 days) - from ActivityLog to include deleted
    prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT
        EXTRACT(HOUR FROM "createdAt")::int as hour,
        COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days' AND action = 'message_sent'
      GROUP BY hour
      ORDER BY hour ASC
    `,

    // Daily messages and chats (last 30 days) - from ActivityLog to include deleted
    prisma.$queryRaw<Array<{ date: Date; messages: bigint; chats: bigint }>>`
      SELECT
        d.date,
        COALESCE(m.count, 0)::bigint as messages,
        COALESCE(c.count, 0)::bigint as chats
      FROM (
        SELECT generate_series(
          (NOW() - INTERVAL '30 days')::date,
          NOW()::date,
          '1 day'::interval
        )::date as date
      ) d
      LEFT JOIN (
        SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
        FROM "ActivityLog"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days' AND action = 'message_sent'
        GROUP BY DATE("createdAt")
      ) m ON m.date = d.date
      LEFT JOIN (
        SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
        FROM "ActivityLog"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days' AND action = 'chat_created'
        GROUP BY DATE("createdAt")
      ) c ON c.date = d.date
      ORDER BY d.date ASC
    `,

    // Hourly messages by agent+model in past 24 hours
    prisma.$queryRaw<Array<{ hour: number; agent: string | null; model: string | null; count: bigint }>>`
      SELECT
        EXTRACT(HOUR FROM "createdAt")::int as hour,
        agent,
        model,
        COUNT(*)::bigint as count
      FROM "Message"
      WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
      GROUP BY hour, agent, model
      ORDER BY hour ASC
    `,
  ])

  // Format model usage
  const modelUsage = modelUsageRaw.map((item) => ({
    model: item.model || "default",
    count: item._count.id,
  }))

  // Format weekly active users for chart
  const weeklyActiveUsers = userGrowthRaw.map((item) => ({
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

  // Format daily messages and chats
  const dailyMessagesChats = dailyMessagesChatsRaw.map((item) => ({
    date: item.date.toISOString().split("T")[0],
    messages: Number(item.messages),
    chats: Number(item.chats),
  }))

  // Format hourly messages by agent+model (past 24 hours)
  // Pivot from [{hour, agent, model, count}] to [{hour: "00:00", "agent/model": 5, ...}]
  const hoursByModel: Record<string, Record<string, number | string>> = {}
  const allAgentModels = new Set<string>()

  for (const row of messagesByModelRaw) {
    const hourStr = String(row.hour).padStart(2, "0")
    const agentName = row.agent || "default"
    const modelName = row.model || "unknown"
    const agentModelKey = `${agentName}/${modelName}`
    allAgentModels.add(agentModelKey)

    if (!hoursByModel[hourStr]) {
      hoursByModel[hourStr] = { hour: `${hourStr}:00` }
    }
    hoursByModel[hourStr][agentModelKey] = Number(row.count)
  }

  // Fill in missing hours with 0
  const messagesByModel: Array<Record<string, number | string>> = []
  const nowHour = new Date().getHours()

  for (let i = 0; i < 24; i++) {
    const hourNum = (nowHour - 23 + i + 24) % 24
    const hourStr = String(hourNum).padStart(2, "0")

    if (!hoursByModel[hourStr]) {
      hoursByModel[hourStr] = { hour: `${hourStr}:00` }
    }
    // Ensure all agent+model combinations have a value
    for (const agentModel of allAgentModels) {
      if (!hoursByModel[hourStr][agentModel]) {
        hoursByModel[hourStr][agentModel] = 0
      }
    }
  }

  // Sort by hour and convert to array
  messagesByModel.push(
    ...Object.values(hoursByModel).sort((a, b) => {
      return (a.hour as string).localeCompare(b.hour as string)
    })
  )

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
    weeklyActiveUsers,
    activityTrends,
    topUsers,
    repoActivity,
    hourlyActivity,
    dailyMessagesChats,
    messagesByModel,
  })
}
