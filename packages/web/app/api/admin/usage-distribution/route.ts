import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getRangeInterval, parseFiniteTimeRange } from "@/lib/db/time-range"

// Providers backed by a shared credential pool. Fixed whitelist — the value is
// bound as a query parameter, never interpolated.
const VALID_PROVIDERS = ["claude", "opencode", "gemini"] as const
type Provider = (typeof VALID_PROVIDERS)[number]

/**
 * GET /api/admin/usage-distribution
 *
 * Powers the "Shared pool & usage" block on the admin Overview: where our
 * credential spend goes, split by pool, by pool key, by user/model, and by
 * per-message size (messageHistogram) — plus `byUser`, a day-by-day-by-user
 * breakdown for the Leaderboard's stacked-area-by-user chart.
 *
 * The 24h range is bucketed by hour-of-day instead of by day — a single day
 * bucket would otherwise collapse the whole stacked area chart to one point,
 * same reasoning as the "stats" route's over-time series.
 *
 * Every response carries BOTH tokens and cost for each series, so the dashboard
 * can toggle between them without a refetch. (Notably this decouples the view
 * from a provider's *budget* unit — OpenCode is budgeted in USD because it spans
 * models with very different per-token prices, but you still want to see its
 * token volume.)
 *
 * Query params:
 *   - range:    "24h" | "7d" | "30d" (default "30d")
 *   - provider: "claude" | "opencode" | "gemini" (default "opencode")
 *   - excludeAdmins: "false" to include admin accounts (default: exclude)
 *
 * Token counts use `totalTokens` to match the "Tokens" metric on the rest of the
 * dashboard, so figures are comparable across sections.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const range = parseFiniteTimeRange(searchParams.get("range"), "30d")
  const providerParam = searchParams.get("provider")
  const provider: Provider = VALID_PROVIDERS.includes(providerParam as Provider)
    ? (providerParam as Provider)
    : "opencode"
  const excludeAdmins = searchParams.get("excludeAdmins") !== "false"
  const interval = getRangeInterval(range)
  // 24h is bucketed by hour-of-day (like the stats route's over-time series)
  // instead of day — a single day bucket would otherwise collapse the whole
  // range to one point.
  const isHourly = range === "24h"

  const notAdmin = Prisma.sql`
    AND (${excludeAdmins} = false OR "userId" NOT IN (SELECT id FROM "User" WHERE "isAdmin" = true))
  `

  // --- Shared vs own-key, per day (or per hour for 24h) ----------------------
  const poolSplitPromise: Promise<Array<{ time: string; pool: string; tokens: number; cost: number }>> =
    isHourly
      ? prisma.$queryRaw<Array<{ hour: number; pool: string; tokens: number; cost: number }>>`
          SELECT
            EXTRACT(HOUR FROM "createdAt")::int as hour,
            "pool" as pool,
            SUM("totalTokens")::float as tokens,
            SUM("costUsd")::float as cost
          FROM "TokenUsage"
          WHERE "createdAt" >= NOW() - '24 hours'::interval
            AND provider = ${provider}
            ${notAdmin}
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `.then((rows) => rows.map((r) => ({ time: String(r.hour), pool: r.pool, tokens: r.tokens, cost: r.cost })))
      : prisma.$queryRaw<Array<{ day: Date; pool: string; tokens: number; cost: number }>>`
          SELECT
            date_trunc('day', "createdAt")::date as day,
            "pool" as pool,
            SUM("totalTokens")::float as tokens,
            SUM("costUsd")::float as cost
          FROM "TokenUsage"
          WHERE "createdAt" >= NOW() - ${interval}::interval
            AND provider = ${provider}
            ${notAdmin}
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `.then((rows) =>
          rows.map((r) => ({
            time: r.day.toISOString().split("T")[0],
            pool: r.pool,
            tokens: r.tokens,
            cost: r.cost,
          }))
        )

  // --- Per pool key, per day or hour (OpenCode is the only multi-key pool) ---
  // Shared pool only: a key id exists only for runs on our credentials.
  const byKeyPromise: Promise<Array<{ time: string; keyId: string | null; tokens: number; cost: number }>> =
    provider !== "opencode"
      ? Promise.resolve([])
      : isHourly
        ? prisma.$queryRaw<Array<{ hour: number; keyId: string | null; tokens: number; cost: number }>>`
            SELECT
              EXTRACT(HOUR FROM "createdAt")::int as hour,
              "keyId" as "keyId",
              SUM("totalTokens")::float as tokens,
              SUM("costUsd")::float as cost
            FROM "TokenUsage"
            WHERE "createdAt" >= NOW() - '24 hours'::interval
              AND provider = ${provider}
              AND "pool" = 'shared'
              ${notAdmin}
            GROUP BY 1, 2
            ORDER BY 1 ASC
          `.then((rows) =>
            rows.map((r) => ({ time: String(r.hour), keyId: r.keyId, tokens: r.tokens, cost: r.cost }))
          )
        : prisma.$queryRaw<Array<{ day: Date; keyId: string | null; tokens: number; cost: number }>>`
            SELECT
              date_trunc('day', "createdAt")::date as day,
              "keyId" as "keyId",
              SUM("totalTokens")::float as tokens,
              SUM("costUsd")::float as cost
            FROM "TokenUsage"
            WHERE "createdAt" >= NOW() - ${interval}::interval
              AND provider = ${provider}
              AND "pool" = 'shared'
              ${notAdmin}
            GROUP BY 1, 2
            ORDER BY 1 ASC
          `.then((rows) =>
            rows.map((r) => ({
              time: r.day.toISOString().split("T")[0],
              keyId: r.keyId,
              tokens: r.tokens,
              cost: r.cost,
            }))
          )

  // --- Per user, per day or hour — for the Leaderboard's stacked-area-by-user
  // chart. Both pools combined (not just shared), matching what `users` below
  // totals as a user's List value: their own-key usage still carries a list
  // price, it's just not billed to us.
  const byUserPromise: Promise<Array<{ time: string; userId: string; tokens: number; cost: number }>> =
    isHourly
      ? prisma.$queryRaw<Array<{ hour: number; userId: string; tokens: number; cost: number }>>`
          SELECT
            EXTRACT(HOUR FROM "createdAt")::int as hour,
            "userId" as "userId",
            SUM("totalTokens")::float as tokens,
            SUM("costUsd")::float as cost
          FROM "TokenUsage"
          WHERE "createdAt" >= NOW() - '24 hours'::interval
            AND provider = ${provider}
            ${notAdmin}
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `.then((rows) =>
          rows.map((r) => ({ time: String(r.hour), userId: r.userId, tokens: r.tokens, cost: r.cost }))
        )
      : prisma.$queryRaw<Array<{ day: Date; userId: string; tokens: number; cost: number }>>`
          SELECT
            date_trunc('day', "createdAt")::date as day,
            "userId" as "userId",
            SUM("totalTokens")::float as tokens,
            SUM("costUsd")::float as cost
          FROM "TokenUsage"
          WHERE "createdAt" >= NOW() - ${interval}::interval
            AND provider = ${provider}
            ${notAdmin}
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `.then((rows) =>
          rows.map((r) => ({
            time: r.day.toISOString().split("T")[0],
            userId: r.userId,
            tokens: r.tokens,
            cost: r.cost,
          }))
        )

  // --- Per user × model × pool ----------------------------------------------
  // The finest grain the table needs; user- and pool-level totals are rolled up
  // from these rows in JS rather than in three separate round trips.
  const perUserPromise = prisma.$queryRaw<
    Array<{
      userId: string
      name: string | null
      image: string | null
      model: string | null
      pool: string
      tokens: number
      cost: number
    }>
  >`
    SELECT
      tu."userId" as "userId",
      u.name as name,
      u.image as image,
      tu.model as model,
      tu."pool" as pool,
      SUM(tu."totalTokens")::float as tokens,
      SUM(tu."costUsd")::float as cost
    FROM "TokenUsage" tu
    JOIN "User" u ON u.id = tu."userId"
    WHERE tu."createdAt" >= NOW() - ${interval}::interval
      AND tu.provider = ${provider}
      AND (${excludeAdmins} = false OR u."isAdmin" = false)
    GROUP BY tu."userId", u.name, u.image, tu.model, tu."pool"
  `

  // --- Per message, for the tokens/cost-per-message histogram ---------------
  // One row per assistant message: how heavy was that single turn. Messages
  // written before per-message attribution existed (messageId null) are
  // excluded rather than lumped into one giant "unattributed" bucket.
  const perMessagePromise = prisma.$queryRaw<Array<{ tokens: number; cost: number }>>`
    SELECT
      SUM(tu."totalTokens")::float as tokens,
      SUM(tu."costUsd")::float as cost
    FROM "TokenUsage" tu
    JOIN "User" u ON u.id = tu."userId"
    WHERE tu."createdAt" >= NOW() - ${interval}::interval
      AND tu.provider = ${provider}
      AND tu."messageId" IS NOT NULL
      AND (${excludeAdmins} = false OR u."isAdmin" = false)
    GROUP BY tu."messageId"
  `

  const [poolSplitRaw, byKeyRaw, byUserRaw, perUserRaw, perMessageRaw] = await Promise.all([
    poolSplitPromise,
    byKeyPromise,
    byUserPromise,
    perUserPromise,
    perMessagePromise,
  ])

  // --- Time axis --------------------------------------------------------------
  // Built in JS so both time series share one gap-free axis. 24h uses one slot
  // per hour-of-day (0-23, matching the EXTRACT(HOUR ...) grouping above);
  // longer ranges use one slot per day, as before.
  const timeKeys: string[] = isHourly
    ? Array.from({ length: 24 }, (_, h) => String(h))
    : (() => {
        const dayCount = range === "7d" ? 7 : 30
        const today = new Date()
        const out: string[] = []
        for (let i = dayCount - 1; i >= 0; i--) {
          const d = new Date(today)
          d.setUTCDate(d.getUTCDate() - i)
          out.push(d.toISOString().split("T")[0])
        }
        return out
      })()

  // --- poolSplit: one row per time slot per metric ---------------------------
  const makeSplit = (metric: "tokens" | "cost") => {
    const map = new Map(timeKeys.map((t) => [t, { time: t, shared: 0, user: 0 }]))
    for (const row of poolSplitRaw) {
      const entry = map.get(row.time)
      if (!entry) continue
      const v = Number(row[metric]) || 0
      if (row.pool === "shared") entry.shared += v
      else entry.user += v
    }
    return [...map.values()]
  }

  // --- byKey: one row per time slot, one column per key -----------------------
  const UNATTRIBUTED = "unattributed"
  const keyIds = new Set<string>()
  for (const row of byKeyRaw) keyIds.add(row.keyId || UNATTRIBUTED)

  const makeByKey = (metric: "tokens" | "cost") => {
    const map = new Map<string, Record<string, number | string>>(
      timeKeys.map((t) => [t, { time: t }])
    )
    for (const row of byKeyRaw) {
      const entry = map.get(row.time)
      if (!entry) continue
      const id = row.keyId || UNATTRIBUTED
      entry[id] = ((entry[id] as number) || 0) + (Number(row[metric]) || 0)
    }
    // Fill gaps so stacked areas render continuously.
    for (const entry of map.values()) {
      for (const id of keyIds) if (entry[id] === undefined) entry[id] = 0
    }
    return [...map.values()]
  }

  // --- byUser: one row per time slot, one column per user id -----------------
  const userIdsInRange = new Set<string>()
  for (const row of byUserRaw) userIdsInRange.add(row.userId)

  const makeByUser = (metric: "tokens" | "cost") => {
    const map = new Map<string, Record<string, number | string>>(
      timeKeys.map((t) => [t, { time: t }])
    )
    for (const row of byUserRaw) {
      const entry = map.get(row.time)
      if (!entry) continue
      entry[row.userId] = ((entry[row.userId] as number) || 0) + (Number(row[metric]) || 0)
    }
    // Fill gaps so stacked areas render continuously.
    for (const entry of map.values()) {
      for (const id of userIdsInRange) if (entry[id] === undefined) entry[id] = 0
    }
    return [...map.values()]
  }

  // --- users: roll the per-model rows up per user ---------------------------
  interface ModelRow {
    model: string
    pool: string
    tokens: number
    cost: number
  }
  const userMap = new Map<
    string,
    {
      userId: string
      name: string
      image: string | null
      tokens: number
      cost: number
      sharedTokens: number
      sharedCost: number
      ownTokens: number
      ownCost: number
      models: ModelRow[]
    }
  >()

  for (const row of perUserRaw) {
    let u = userMap.get(row.userId)
    if (!u) {
      u = {
        userId: row.userId,
        name: row.name || "Unknown",
        image: row.image,
        tokens: 0,
        cost: 0,
        sharedTokens: 0,
        sharedCost: 0,
        ownTokens: 0,
        ownCost: 0,
        models: [],
      }
      userMap.set(row.userId, u)
    }
    const tokens = Number(row.tokens) || 0
    const cost = Number(row.cost) || 0
    u.tokens += tokens
    u.cost += cost
    if (row.pool === "shared") {
      u.sharedTokens += tokens
      u.sharedCost += cost
    } else {
      u.ownTokens += tokens
      u.ownCost += cost
    }
    u.models.push({ model: row.model || "unknown", pool: row.pool, tokens, cost })
  }

  const users = [...userMap.values()]
    .map((u) => ({
      ...u,
      // Heaviest model first so the expanded row leads with what matters.
      models: u.models.sort((a, b) => b.tokens - a.tokens),
    }))
    .filter((u) => u.tokens > 0 || u.cost > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)

  // --- messageHistogram: equal-width bins from 0 to the heaviest message ----
  const HISTOGRAM_BUCKETS = 10
  const makeHistogram = (values: number[]) => {
    const positive = values.filter((v) => Number.isFinite(v) && v >= 0)
    if (positive.length === 0) return []
    const max = Math.max(...positive)
    if (max <= 0) return [{ bucketStart: 0, bucketEnd: 0, count: positive.length }]
    const width = max / HISTOGRAM_BUCKETS
    const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, i) => ({
      bucketStart: i * width,
      bucketEnd: (i + 1) * width,
      count: 0,
    }))
    for (const v of positive) {
      const idx = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(v / width))
      buckets[idx].count += 1
    }
    return buckets
  }

  return NextResponse.json({
    range,
    provider,
    days: timeKeys,
    keyIds: [...keyIds].sort(),
    poolSplit: { tokens: makeSplit("tokens"), cost: makeSplit("cost") },
    byKey: { tokens: makeByKey("tokens"), cost: makeByKey("cost") },
    byUser: { tokens: makeByUser("tokens"), cost: makeByUser("cost") },
    users,
    messageHistogram: {
      tokens: makeHistogram(perMessageRaw.map((r) => Number(r.tokens) || 0)),
      cost: makeHistogram(perMessageRaw.map((r) => Number(r.cost) || 0)),
    },
  })
}
