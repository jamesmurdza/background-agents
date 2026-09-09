import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import {
  getBucket,
  getBucketStep,
  getRangeDays,
  getRangeInterval,
  parseTimeRange,
} from "@/lib/db/time-range"
import { MICRO_PER_USD } from "@/lib/server/credits"

/**
 * For the "all" range there is no fixed window, so derive the interval/days
 * dynamically from the earliest purchase. Falls back to 1 day when there are
 * no top-ups yet.
 */
async function getAllTimeWindow(): Promise<{ interval: string; days: number }> {
  const earliest = await prisma.$queryRaw<Array<{ min: Date | null }>>`
    SELECT MIN("createdAt") as min FROM "CreditTransaction" WHERE type = 'purchase'
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
 * GET /api/admin/topups
 *
 * Credit ledger (CreditTransaction) rollups, for two views on the admin
 * dashboard:
 *   - `series`: a running (cumulative) total of top-up payments over time,
 *     for the Overview chart. Scoped to `type = 'purchase'` only — this
 *     answers "how much have we raised, and when."
 *   - `users`: every user with a purchase or a usage debit in range, topped-up
 *     and spent totals side by side, for the Leaderboard's Usage by user
 *     table. Refunds, chargebacks, grants, and adjustments are left out of
 *     both — they don't answer "what did this user pay us and get charged."
 *
 * Query params:
 *   - range: "24h" | "7d" | "30d" | "all" (default "30d")
 *   - excludeAdmins: "false" to include admin accounts (default: exclude)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const range = parseTimeRange(searchParams.get("range"), "30d")
  const excludeAdmins = searchParams.get("excludeAdmins") !== "false"
  const { interval, days } =
    range === "all" ? await getAllTimeWindow() : { interval: getRangeInterval(range), days: getRangeDays(range) }
  const bucket = getBucket(days)
  const bucketStep = getBucketStep(bucket)

  // "all" contributes no time clause; every other range binds the interval as
  // a parameter (not interpolated) so it can never carry injected SQL.
  const rangeWhere = Prisma.sql`AND ct."createdAt" >= NOW() - ${interval}::interval`
  const adminWhere = Prisma.sql`AND (${excludeAdmins} = false OR u."isAdmin" = false)`

  // Every user with a purchase or a usage debit in range — no LIMIT, since the
  // Leaderboard's Usage by user table wants the full roster, not just the top
  // payers. "debit" rows are what actually left the balance (chargeableUsd),
  // signed negative in the ledger — see lib/server/credits — so spentMicroUsd
  // negates them back to a positive figure.
  const ledgerPromise = prisma.$queryRaw<
    Array<{
      userId: string
      name: string | null
      image: string | null
      toppedUpMicroUsd: number
      spentMicroUsd: number
      purchaseCount: bigint
    }>
  >`
    SELECT
      u.id as "userId",
      u.name,
      u.image,
      COALESCE(SUM(CASE WHEN ct.type = 'purchase' THEN ct."amountMicroUsd" ELSE 0 END), 0)::float as "toppedUpMicroUsd",
      COALESCE(SUM(CASE WHEN ct.type = 'debit' THEN -ct."amountMicroUsd" ELSE 0 END), 0)::float as "spentMicroUsd",
      COUNT(CASE WHEN ct.type = 'purchase' THEN 1 END)::bigint as "purchaseCount"
    FROM "CreditTransaction" ct
    JOIN "User" u ON u.id = ct."userId"
    WHERE ct.type IN ('purchase', 'debit')
      ${rangeWhere}
      ${adminWhere}
    GROUP BY u.id, u.name, u.image
    ORDER BY "toppedUpMicroUsd" DESC, "spentMicroUsd" DESC
  `

  const totalPromise = prisma.$queryRaw<Array<{ totalMicroUsd: number | null; count: bigint }>>`
    SELECT SUM(ct."amountMicroUsd")::float as "totalMicroUsd", COUNT(ct.id)::bigint as count
    FROM "CreditTransaction" ct
    JOIN "User" u ON u.id = ct."userId"
    WHERE ct.type = 'purchase'
      ${rangeWhere}
      ${adminWhere}
  `

  // --- Running total over time (hourly for 24h, bucketed otherwise) --------
  // Per-bucket sums are computed in SQL; the running total is accumulated in
  // JS below, same as every other bucketed series on this dashboard.
  const seriesPromise: Promise<Array<{ time: string; value: number }>> =
    range === "24h"
      ? prisma.$queryRaw<Array<{ hour: number; value: number }>>`
          SELECT h.hour, COALESCE(t.value, 0)::float as value
          FROM (SELECT generate_series(0, 23) as hour) h
          LEFT JOIN (
            SELECT EXTRACT(HOUR FROM ct."createdAt")::int as hour, SUM(ct."amountMicroUsd")::float as value
            FROM "CreditTransaction" ct
            JOIN "User" u ON u.id = ct."userId"
            WHERE ct.type = 'purchase' AND ct."createdAt" >= NOW() - '24 hours'::interval
              ${adminWhere}
            GROUP BY 1
          ) t ON t.hour = h.hour
          ORDER BY h.hour ASC
        `.then((rows) => rows.map((r) => ({ time: String(r.hour), value: Number(r.value) })))
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
            SELECT date_trunc(${bucket}, ct."createdAt")::date as date, SUM(ct."amountMicroUsd")::float as value
            FROM "CreditTransaction" ct
            JOIN "User" u ON u.id = ct."userId"
            WHERE ct.type = 'purchase'
              ${rangeWhere}
              ${adminWhere}
            GROUP BY 1
          ) t ON t.date = d.date
          ORDER BY d.date ASC
        `.then((rows) =>
          rows.map((r) => ({ time: r.date.toISOString().split("T")[0], value: Number(r.value) }))
        )

  const [ledger, totalRows, seriesRaw] = await Promise.all([
    ledgerPromise,
    totalPromise,
    seriesPromise,
  ])

  const users = ledger.map((r) => ({
    userId: r.userId,
    name: r.name || "Unknown",
    image: r.image,
    toppedUpUsd: r.toppedUpMicroUsd / MICRO_PER_USD,
    spentUsd: r.spentMicroUsd / MICRO_PER_USD,
    purchaseCount: Number(r.purchaseCount),
  }))

  const totalRow = totalRows[0]

  // Accumulate bucket sums into a running total, so the Overview chart reads
  // as "total raised so far" rather than a spiky per-bucket amount.
  let running = 0
  const series = seriesRaw.map((point) => {
    running += point.value / MICRO_PER_USD
    return { time: point.time, cumulativeUsd: running }
  })

  return NextResponse.json({
    range,
    totalUsd: (totalRow?.totalMicroUsd ?? 0) / MICRO_PER_USD,
    totalCount: Number(totalRow?.count ?? 0),
    users,
    series,
  })
}
