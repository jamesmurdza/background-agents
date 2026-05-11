import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"

type TimeRange = "24h" | "7d" | "30d"

function getRangeInterval(range: TimeRange): string {
  switch (range) {
    case "24h":
      return "1 day"
    case "7d":
      return "7 days"
    case "30d":
      return "30 days"
    default:
      return "7 days"
  }
}

function getRangeDays(range: TimeRange): number {
  switch (range) {
    case "24h":
      return 1
    case "7d":
      return 7
    case "30d":
      return 30
    default:
      return 7
  }
}

/**
 * GET /api/admin/stats
 * Returns platform-wide statistics for the admin dashboard
 * Query params:
 *   - range: "24h" | "7d" | "30d" (default: "7d")
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const range = (searchParams.get("range") as TimeRange) || "7d"
  const interval = getRangeInterval(range)
  const days = getRangeDays(range)

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
    messagesByAgentModelRaw,
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

    // Weekly active users (WAU) - for the selected range, count unique users active in the preceding 7 days
    prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT d.date, COUNT(DISTINCT a."userId")::bigint as count
      FROM (
        SELECT generate_series(
          (NOW() - ${interval}::interval)::date,
          NOW()::date,
          '1 day'::interval
        )::date as date
      ) d
      LEFT JOIN "ActivityLog" a ON a."createdAt" >= d.date - INTERVAL '6 days' AND a."createdAt" < d.date + INTERVAL '1 day'
      GROUP BY d.date
      ORDER BY d.date ASC
    `,

    // Activity by day for selected range
    prisma.$queryRaw<Array<{ date: Date; action: string; count: bigint }>>`
      SELECT DATE("createdAt") as date, action, COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE "createdAt" >= NOW() - ${interval}::interval
      GROUP BY DATE("createdAt"), action
      ORDER BY date ASC
    `,

    // Top active users (by message count in selected range) - from ActivityLog to include deleted
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

    // Hourly activity distribution (selected range) - from ActivityLog to include deleted
    prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT
        EXTRACT(HOUR FROM "createdAt")::int as hour,
        COUNT(*)::bigint as count
      FROM "ActivityLog"
      WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'message_sent'
      GROUP BY hour
      ORDER BY hour ASC
    `,

    // Messages and chats by time period (hourly for 24h, daily for 7d/30d)
    range === "24h"
      ? prisma.$queryRaw<Array<{ hour: number; messages: bigint; chats: bigint }>>`
          SELECT
            h.hour,
            COALESCE(m.count, 0)::bigint as messages,
            COALESCE(c.count, 0)::bigint as chats
          FROM (
            SELECT generate_series(0, 23) as hour
          ) h
          LEFT JOIN (
            SELECT EXTRACT(HOUR FROM "createdAt")::int as hour, COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - '24 hours'::interval AND action = 'message_sent'
            GROUP BY EXTRACT(HOUR FROM "createdAt")::int
          ) m ON m.hour = h.hour
          LEFT JOIN (
            SELECT EXTRACT(HOUR FROM "createdAt")::int as hour, COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - '24 hours'::interval AND action = 'chat_created'
            GROUP BY EXTRACT(HOUR FROM "createdAt")::int
          ) c ON c.hour = h.hour
          ORDER BY h.hour ASC
        `
      : prisma.$queryRaw<Array<{ date: Date; messages: bigint; chats: bigint }>>`
          SELECT
            d.date,
            COALESCE(m.count, 0)::bigint as messages,
            COALESCE(c.count, 0)::bigint as chats
          FROM (
            SELECT generate_series(
              (NOW() - ${interval}::interval)::date,
              NOW()::date,
              '1 day'::interval
            )::date as date
          ) d
          LEFT JOIN (
            SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'message_sent'
            GROUP BY DATE("createdAt")
          ) m ON m.date = d.date
          LEFT JOIN (
            SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'chat_created'
            GROUP BY DATE("createdAt")
          ) c ON c.date = d.date
          ORDER BY d.date ASC
        `,

    // Messages by agent+model (hourly for 24h, daily for 7d/30d)
    // Use ActivityLog to include deleted messages and be consistent with other metrics
    range === "24h"
      ? prisma.$queryRaw<Array<{ hour: number; agent: string | null; model: string | null; count: bigint }>>`
          SELECT
            EXTRACT(HOUR FROM "createdAt")::int as hour,
            metadata->>'agent' as agent,
            metadata->>'model' as model,
            COUNT(*)::bigint as count
          FROM "ActivityLog"
          WHERE "createdAt" >= NOW() - '24 hours'::interval
            AND action = 'message_sent'
          GROUP BY hour, metadata->>'agent', metadata->>'model'
          ORDER BY hour ASC
        `
      : prisma.$queryRaw<Array<{ date: Date; agent: string | null; model: string | null; count: bigint }>>`
          SELECT
            DATE("createdAt") as date,
            metadata->>'agent' as agent,
            metadata->>'model' as model,
            COUNT(*)::bigint as count
          FROM "ActivityLog"
          WHERE "createdAt" >= NOW() - ${interval}::interval
            AND action = 'message_sent'
          GROUP BY date, metadata->>'agent', metadata->>'model'
          ORDER BY date ASC
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

  // Format messages and chats (hourly for 24h, daily otherwise)
  const messagesChats = range === "24h"
    ? (dailyMessagesChatsRaw as Array<{ hour: number; messages: bigint; chats: bigint }>).map((item) => ({
        time: String(item.hour),
        messages: Number(item.messages),
        chats: Number(item.chats),
      }))
    : (dailyMessagesChatsRaw as Array<{ date: Date; messages: bigint; chats: bigint }>).map((item) => ({
        time: item.date.toISOString().split("T")[0],
        messages: Number(item.messages),
        chats: Number(item.chats),
      }))

  // Helper function to format messages by agent/model (hourly or daily)
  function formatMessagesByAgentModel(
    rawData: Array<{ hour?: number; date?: Date; agent: string | null; model: string | null; count: bigint }>
  ) {
    const byAgentMap: Record<string, Record<string, number | string>> = {}
    const byModelMap: Record<string, Record<string, number | string>> = {}
    const allAgents = new Set<string>()
    const allModels = new Set<string>()

    for (const row of rawData) {
      const timeKey = range === "24h" ? String(row.hour) : row.date!.toISOString().split("T")[0]
      const agentName = row.agent || "unknown"
      const modelName = row.model || "unknown"
      const count = Number(row.count)

      allAgents.add(agentName)
      allModels.add(modelName)

      // Aggregate by agent
      if (!byAgentMap[timeKey]) {
        byAgentMap[timeKey] = { time: timeKey }
      }
      byAgentMap[timeKey][agentName] =
        ((byAgentMap[timeKey][agentName] as number) || 0) + count

      // Aggregate by model
      if (!byModelMap[timeKey]) {
        byModelMap[timeKey] = { time: timeKey }
      }
      byModelMap[timeKey][modelName] =
        ((byModelMap[timeKey][modelName] as number) || 0) + count
    }

    // Fill in missing time slots with 0
    if (range === "24h") {
      // Fill all 24 hours
      for (let h = 0; h < 24; h++) {
        const timeKey = String(h)
        if (!byAgentMap[timeKey]) {
          byAgentMap[timeKey] = { time: timeKey }
        }
        if (!byModelMap[timeKey]) {
          byModelMap[timeKey] = { time: timeKey }
        }
        for (const agent of allAgents) {
          if (!byAgentMap[timeKey][agent]) {
            byAgentMap[timeKey][agent] = 0
          }
        }
        for (const model of allModels) {
          if (!byModelMap[timeKey][model]) {
            byModelMap[timeKey][model] = 0
          }
        }
      }
    } else {
      // Fill in missing days
      const today = new Date()
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const timeKey = d.toISOString().split("T")[0]

        if (!byAgentMap[timeKey]) {
          byAgentMap[timeKey] = { time: timeKey }
        }
        if (!byModelMap[timeKey]) {
          byModelMap[timeKey] = { time: timeKey }
        }
        for (const agent of allAgents) {
          if (!byAgentMap[timeKey][agent]) {
            byAgentMap[timeKey][agent] = 0
          }
        }
        for (const model of allModels) {
          if (!byModelMap[timeKey][model]) {
            byModelMap[timeKey][model] = 0
          }
        }
      }
    }

    // Sort by time and convert to arrays
    const sortFn = range === "24h"
      ? (a: Record<string, number | string>, b: Record<string, number | string>) =>
          Number(a.time) - Number(b.time)
      : (a: Record<string, number | string>, b: Record<string, number | string>) =>
          (a.time as string).localeCompare(b.time as string)

    const byAgent = Object.values(byAgentMap).sort(sortFn)
    const byModel = Object.values(byModelMap).sort(sortFn)

    return { byAgent, byModel }
  }

  const messagesByAgentModel = formatMessagesByAgentModel(messagesByAgentModelRaw as Array<{ hour?: number; date?: Date; agent: string | null; model: string | null; count: bigint }>)

  return NextResponse.json({
    range,
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
    messagesChats,
    messagesByAgent: messagesByAgentModel.byAgent,
    messagesByModel: messagesByAgentModel.byModel,
  })
}
