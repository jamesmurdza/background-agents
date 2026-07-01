import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getRangeDays, getRangeInterval, parseTimeRange } from "@/lib/db/time-range"

// Primary metric the dashboard charts are weighted by. "messages" counts
// ActivityLog rows; "tokens"/"cost" aggregate the TokenUsage ledger.
const VALID_METRICS = ["tokens", "cost", "messages"] as const
type Metric = (typeof VALID_METRICS)[number]

// Bucket granularity used for time-series charts. Long ranges (i.e. "all")
// are down-sampled so the charts stay readable instead of rendering thousands
// of daily points.
type Bucket = "day" | "week" | "month"

function getBucket(days: number): Bucket {
  if (days <= 90) return "day"
  if (days <= 730) return "week"
  return "month"
}

function getBucketStep(bucket: Bucket): string {
  switch (bucket) {
    case "week":
      return "1 week"
    case "month":
      return "1 month"
    default:
      return "1 day"
  }
}

/**
 * For the "all" range there is no fixed window, so derive the interval/days
 * dynamically from the earliest ActivityLog entry. Falls back to 1 day when
 * there is no activity yet.
 */
async function getAllTimeWindow(): Promise<{ interval: string; days: number }> {
  const earliest = await prisma.$queryRaw<Array<{ min: Date | null }>>`
    SELECT MIN("createdAt") as min FROM "ActivityLog"
  `
  const minDate = earliest[0]?.min
  if (!minDate) {
    return { interval: "1 day", days: 1 }
  }
  const diffMs = Date.now() - new Date(minDate).getTime()
  const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
  return { interval: `${days} days`, days }
}

/**
 * GET /api/admin/stats
 * Returns platform-wide statistics for the admin dashboard
 * Query params:
 *   - range: "24h" | "7d" | "30d" | "all" (default: "7d")
 *   - metric: "tokens" | "cost" | "messages" (default: "tokens")
 *
 * The metric-bearing charts (over-time series, by agent/model, top users, by
 * hour) are weighted by the selected metric. "messages" counts ActivityLog
 * rows; "tokens"/"cost" sum the TokenUsage ledger. Weekly active users is
 * always user-based and ignores the metric.
 *
 * Time-series charts are bucketed by day for ranges up to ~90 days, by week up
 * to ~2 years, and by month beyond that. This keeps the long "all" range
 * readable instead of plotting thousands of daily points.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const range = parseTimeRange(searchParams.get("range"), "7d")
  const metricParam = searchParams.get("metric")
  const metric: Metric = VALID_METRICS.includes(metricParam as Metric)
    ? (metricParam as Metric)
    : "tokens"
  const isMessages = metric === "messages"
  // SQL aggregate over the TokenUsage ledger for the selected token metric.
  // Identifier is from a fixed whitelist (never user input), so Prisma.raw is safe.
  const tokenValue = Prisma.raw(
    metric === "cost" ? `SUM("costUsd")::float` : `SUM("totalTokens")::float`
  )
  // Exclude admin users' activity from the overview stats by default; callers
  // opt back in with ?excludeAdmins=false.
  const excludeAdmins = searchParams.get("excludeAdmins") !== "false"
  const { interval, days } =
    range === "all"
      ? await getAllTimeWindow()
      : { interval: getRangeInterval(range), days: getRangeDays(range) }

  // Time-series granularity (only used for the non-hourly ranges). For 7d/30d
  // this resolves to "day" so existing behavior is unchanged.
  const bucket = getBucket(days)
  const bucketStep = getBucketStep(bucket)

  // --- Weekly active users (metric-independent) ---------------------------
  const userGrowthPromise = prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT d.date, COUNT(DISTINCT a."userId")::bigint as count
    FROM (
      SELECT generate_series(
        date_trunc(${bucket}, NOW() - ${interval}::interval),
        date_trunc(${bucket}, NOW()),
        ${bucketStep}::interval
      )::date as date
    ) d
    LEFT JOIN "ActivityLog" a ON a."createdAt" >= d.date - INTERVAL '6 days' AND a."createdAt" < d.date + INTERVAL '1 day'
      AND (${excludeAdmins} = false OR a."userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
    GROUP BY d.date
    ORDER BY d.date ASC
  `

  // --- Top users by selected metric ---------------------------------------
  const topUsersPromise: Promise<
    Array<{ userId: string; name: string | null; image: string | null; primary: number; secondary: number | null }>
  > = isMessages
    ? prisma.$queryRaw<Array<{ userId: string; name: string | null; image: string | null; messageCount: bigint; chatCount: bigint }>>`
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
          AND (${excludeAdmins} = false OR u."isAdmin" = false)
        ORDER BY "messageCount" DESC
        LIMIT 10
      `.then((rows) =>
        rows.map((r) => ({
          userId: r.userId,
          name: r.name,
          image: r.image,
          primary: Number(r.messageCount),
          secondary: Number(r.chatCount),
        }))
      )
    : prisma.$queryRaw<Array<{ userId: string; name: string | null; image: string | null; value: number }>>`
        SELECT u.id as "userId", u.name, u.image, ${tokenValue} as value
        FROM "TokenUsage" tu
        JOIN "User" u ON u.id = tu."userId"
        WHERE tu."createdAt" >= NOW() - ${interval}::interval
          AND (${excludeAdmins} = false OR u."isAdmin" = false)
        GROUP BY u.id, u.name, u.image
        HAVING ${tokenValue} > 0
        ORDER BY value DESC
        LIMIT 10
      `.then((rows) =>
        rows.map((r) => ({
          userId: r.userId,
          name: r.name,
          image: r.image,
          primary: Number(r.value),
          secondary: null,
        }))
      )

  // --- By-hour distribution (selected range) ------------------------------
  const hourlyPromise: Promise<Array<{ hour: number; value: number }>> = isMessages
    ? prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
        SELECT
          EXTRACT(HOUR FROM "createdAt")::int as hour,
          COUNT(*)::bigint as count
        FROM "ActivityLog"
        WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'message_sent'
          AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
        GROUP BY hour
        ORDER BY hour ASC
      `.then((rows) => rows.map((r) => ({ hour: r.hour, value: Number(r.count) })))
    : prisma.$queryRaw<Array<{ hour: number; value: number }>>`
        SELECT
          EXTRACT(HOUR FROM "createdAt")::int as hour,
          ${tokenValue} as value
        FROM "TokenUsage"
        WHERE "createdAt" >= NOW() - ${interval}::interval
          AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
        GROUP BY hour
        ORDER BY hour ASC
      `.then((rows) => rows.map((r) => ({ hour: r.hour, value: Number(r.value) })))

  // --- Over-time series (hourly for 24h, bucketed otherwise) --------------
  // Messages carries a second series (conversations); tokens/cost is single-value.
  type SeriesRow = { time: string; value: number; value2: number | null }
  const seriesPromise: Promise<SeriesRow[]> = isMessages
    ? (range === "24h"
        ? prisma.$queryRaw<Array<{ hour: number; messages: bigint; chats: bigint }>>`
            SELECT
              h.hour,
              COALESCE(m.count, 0)::bigint as messages,
              COALESCE(c.count, 0)::bigint as chats
            FROM (SELECT generate_series(0, 23) as hour) h
            LEFT JOIN (
              SELECT EXTRACT(HOUR FROM "createdAt")::int as hour, COUNT(*)::bigint as count
              FROM "ActivityLog"
              WHERE "createdAt" >= NOW() - '24 hours'::interval AND action = 'message_sent'
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY EXTRACT(HOUR FROM "createdAt")::int
            ) m ON m.hour = h.hour
            LEFT JOIN (
              SELECT EXTRACT(HOUR FROM "createdAt")::int as hour, COUNT(*)::bigint as count
              FROM "ActivityLog"
              WHERE "createdAt" >= NOW() - '24 hours'::interval AND action = 'chat_created'
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY EXTRACT(HOUR FROM "createdAt")::int
            ) c ON c.hour = h.hour
            ORDER BY h.hour ASC
          `.then((rows) =>
            rows.map((r) => ({ time: String(r.hour), value: Number(r.messages), value2: Number(r.chats) }))
          )
        : prisma.$queryRaw<Array<{ date: Date; messages: bigint; chats: bigint }>>`
            SELECT
              d.date,
              COALESCE(m.count, 0)::bigint as messages,
              COALESCE(c.count, 0)::bigint as chats
            FROM (
              SELECT generate_series(
                date_trunc(${bucket}, NOW() - ${interval}::interval),
                date_trunc(${bucket}, NOW()),
                ${bucketStep}::interval
              )::date as date
            ) d
            LEFT JOIN (
              SELECT date_trunc(${bucket}, "createdAt")::date as date, COUNT(*)::bigint as count
              FROM "ActivityLog"
              WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'message_sent'
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY 1
            ) m ON m.date = d.date
            LEFT JOIN (
              SELECT date_trunc(${bucket}, "createdAt")::date as date, COUNT(*)::bigint as count
              FROM "ActivityLog"
              WHERE "createdAt" >= NOW() - ${interval}::interval AND action = 'chat_created'
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY 1
            ) c ON c.date = d.date
            ORDER BY d.date ASC
          `.then((rows) =>
            rows.map((r) => ({
              time: r.date.toISOString().split("T")[0],
              value: Number(r.messages),
              value2: Number(r.chats),
            }))
          ))
    : (range === "24h"
        ? prisma.$queryRaw<Array<{ hour: number; value: number }>>`
            SELECT h.hour, COALESCE(t.value, 0)::float as value
            FROM (SELECT generate_series(0, 23) as hour) h
            LEFT JOIN (
              SELECT EXTRACT(HOUR FROM "createdAt")::int as hour, ${tokenValue} as value
              FROM "TokenUsage"
              WHERE "createdAt" >= NOW() - '24 hours'::interval
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY 1
            ) t ON t.hour = h.hour
            ORDER BY h.hour ASC
          `.then((rows) => rows.map((r) => ({ time: String(r.hour), value: Number(r.value), value2: null })))
        : prisma.$queryRaw<Array<{ date: Date; value: number }>>`
            SELECT d.date, COALESCE(t.value, 0)::float as value
            FROM (
              SELECT generate_series(
                date_trunc(${bucket}, NOW() - ${interval}::interval),
                date_trunc(${bucket}, NOW()),
                ${bucketStep}::interval
              )::date as date
            ) d
            LEFT JOIN (
              SELECT date_trunc(${bucket}, "createdAt")::date as date, ${tokenValue} as value
              FROM "TokenUsage"
              WHERE "createdAt" >= NOW() - ${interval}::interval
                AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
              GROUP BY 1
            ) t ON t.date = d.date
            ORDER BY d.date ASC
          `.then((rows) =>
            rows.map((r) => ({ time: r.date.toISOString().split("T")[0], value: Number(r.value), value2: null }))
          ))

  // --- By agent + model (hourly for 24h, bucketed otherwise) --------------
  // Both branches produce {hour|date, agent, model, count}; for tokens/cost the
  // "agent" is the TokenUsage provider and "count" is the summed metric value.
  const byAgentModelPromise: Promise<
    Array<{ hour?: number; date?: Date; agent: string | null; model: string | null; count: number }>
  > = isMessages
    ? (range === "24h"
        ? prisma.$queryRaw<Array<{ hour: number; agent: string | null; model: string | null; count: bigint }>>`
            SELECT
              EXTRACT(HOUR FROM "createdAt")::int as hour,
              metadata->>'agent' as agent,
              metadata->>'model' as model,
              COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - '24 hours'::interval
              AND action = 'message_sent'
              AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
            GROUP BY hour, metadata->>'agent', metadata->>'model'
            ORDER BY hour ASC
          `.then((rows) => rows.map((r) => ({ hour: r.hour, agent: r.agent, model: r.model, count: Number(r.count) })))
        : prisma.$queryRaw<Array<{ date: Date; agent: string | null; model: string | null; count: bigint }>>`
            SELECT
              date_trunc(${bucket}, "createdAt")::date as date,
              metadata->>'agent' as agent,
              metadata->>'model' as model,
              COUNT(*)::bigint as count
            FROM "ActivityLog"
            WHERE "createdAt" >= NOW() - ${interval}::interval
              AND action = 'message_sent'
              AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
            GROUP BY 1, metadata->>'agent', metadata->>'model'
            ORDER BY 1 ASC
          `.then((rows) => rows.map((r) => ({ date: r.date, agent: r.agent, model: r.model, count: Number(r.count) }))))
    : (range === "24h"
        ? prisma.$queryRaw<Array<{ hour: number; agent: string | null; model: string | null; count: number }>>`
            SELECT
              EXTRACT(HOUR FROM "createdAt")::int as hour,
              provider as agent,
              model,
              ${tokenValue} as count
            FROM "TokenUsage"
            WHERE "createdAt" >= NOW() - '24 hours'::interval
              AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
            GROUP BY hour, provider, model
            ORDER BY hour ASC
          `.then((rows) => rows.map((r) => ({ hour: r.hour, agent: r.agent, model: r.model, count: Number(r.count) })))
        : prisma.$queryRaw<Array<{ date: Date; agent: string | null; model: string | null; count: number }>>`
            SELECT
              date_trunc(${bucket}, "createdAt")::date as date,
              provider as agent,
              model,
              ${tokenValue} as count
            FROM "TokenUsage"
            WHERE "createdAt" >= NOW() - ${interval}::interval
              AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
            GROUP BY 1, provider, model
            ORDER BY 1 ASC
          `.then((rows) => rows.map((r) => ({ date: r.date, agent: r.agent, model: r.model, count: Number(r.count) }))))

  // Run all queries in parallel for performance
  const [userGrowthRaw, topUsers, hourly, series, byAgentModelRaw] = await Promise.all([
    userGrowthPromise,
    topUsersPromise,
    hourlyPromise,
    seriesPromise,
    byAgentModelPromise,
  ])

  // Format weekly active users for chart
  const weeklyActiveUsers = userGrowthRaw.map((item) => ({
    date: item.date.toISOString().split("T")[0],
    count: Number(item.count),
  }))

  const topUsersFormatted = topUsers.map((item) => ({
    name: item.name || "Unknown",
    image: item.image,
    primary: item.primary,
    secondary: item.secondary,
  }))

  // Helper function to format the by-agent/model rows into stacked-area series
  // keyed by time. `timeKeys` is the canonical, gap-free list of time slots for
  // the non-hourly case (derived from the bucketed series), so the fill below
  // lines up exactly with the chosen day/week/month buckets.
  function formatByAgentModel(
    rawData: Array<{ hour?: number; date?: Date; agent: string | null; model: string | null; count: number }>,
    timeKeys: string[]
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

      if (!byAgentMap[timeKey]) byAgentMap[timeKey] = { time: timeKey }
      byAgentMap[timeKey][agentName] = ((byAgentMap[timeKey][agentName] as number) || 0) + count

      if (!byModelMap[timeKey]) byModelMap[timeKey] = { time: timeKey }
      byModelMap[timeKey][modelName] = ((byModelMap[timeKey][modelName] as number) || 0) + count
    }

    // Fill in missing time slots with 0
    const keys = range === "24h" ? Array.from({ length: 24 }, (_, h) => String(h)) : timeKeys
    for (const timeKey of keys) {
      if (!byAgentMap[timeKey]) byAgentMap[timeKey] = { time: timeKey }
      if (!byModelMap[timeKey]) byModelMap[timeKey] = { time: timeKey }
      for (const agent of allAgents) {
        if (!byAgentMap[timeKey][agent]) byAgentMap[timeKey][agent] = 0
      }
      for (const model of allModels) {
        if (!byModelMap[timeKey][model]) byModelMap[timeKey][model] = 0
      }
    }

    const sortFn =
      range === "24h"
        ? (a: Record<string, number | string>, b: Record<string, number | string>) =>
            Number(a.time) - Number(b.time)
        : (a: Record<string, number | string>, b: Record<string, number | string>) =>
            (a.time as string).localeCompare(b.time as string)

    return {
      byAgent: Object.values(byAgentMap).sort(sortFn),
      byModel: Object.values(byModelMap).sort(sortFn),
    }
  }

  const { byAgent, byModel } = formatByAgentModel(
    byAgentModelRaw,
    series.map((d) => d.time)
  )

  return NextResponse.json({
    range,
    metric,
    weeklyActiveUsers,
    topUsers: topUsersFormatted,
    hourly,
    series,
    byAgent,
    byModel,
  })
}
