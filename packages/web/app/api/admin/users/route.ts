import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
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
 * - sortField: Field to sort by (name, email, createdAt, totalMessages, lastActivityAt)
 * - sortOrder: Sort order (asc, desc) - default: desc
 *
 * Sorting note: `totalMessages` and `lastActivityAt` are computed from
 * ActivityLog, so they're sorted at the DB level via raw SQL (joins +
 * aggregates) and *then* paginated. Otherwise each page would be sorted
 * independently and the order wouldn't be consistent across pages.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)))
  const search = searchParams.get("search")
  const rawSortField = searchParams.get("sortField") || "createdAt"
  const rawSortOrder = searchParams.get("sortOrder") || "desc"

  // Whitelist sort field & order (defensive — also gates the raw-SQL paths below)
  const ALLOWED_SORT_FIELDS = [
    "name",
    "email",
    "createdAt",
    "totalMessages",
    "lastActivityAt",
  ] as const
  type SortField = (typeof ALLOWED_SORT_FIELDS)[number]
  const sortField: SortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(rawSortField)
    ? (rawSortField as SortField)
    : "createdAt"
  const sortOrder: "asc" | "desc" = rawSortOrder === "asc" ? "asc" : "desc"

  const skip = (page - 1) * limit

  // Build where clause for search (Prisma form, used for findMany + count)
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { githubId: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}

  // Step 1: get the ordered, paginated user IDs (and total count).
  // For computed sort fields, we must order by the aggregate at the DB level
  // BEFORE paginating, otherwise each page would be re-sorted in isolation.
  let orderedUserIds: string[]
  let total: number

  if (sortField === "totalMessages" || sortField === "lastActivityAt") {
    // Raw-SQL WHERE fragment for search (mirrors the Prisma `where` above).
    const searchPattern = search ? `%${search}%` : null
    const searchWhere =
      search && searchPattern
        ? Prisma.sql`WHERE u.name ILIKE ${searchPattern} OR u.email ILIKE ${searchPattern} OR u."githubId" ILIKE ${searchPattern}`
        : Prisma.empty

    if (sortField === "totalMessages") {
      // Tie-break by u.id so pagination is stable when counts are equal.
      const directionSql = sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT u.id
        FROM "User" u
        LEFT JOIN (
          SELECT "userId", COUNT(*) AS count
          FROM "ActivityLog"
          WHERE action = 'message_sent'
          GROUP BY "userId"
        ) msg ON msg."userId" = u.id
        ${searchWhere}
        ORDER BY COALESCE(msg.count, 0) ${directionSql}, u.id ASC
        LIMIT ${limit} OFFSET ${skip}
      `
      orderedUserIds = rows.map((r) => r.id)
    } else {
      // lastActivityAt — keep users with no activity at the trailing end.
      const directionSql =
        sortOrder === "asc" ? Prisma.sql`ASC NULLS FIRST` : Prisma.sql`DESC NULLS LAST`
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT u.id
        FROM "User" u
        LEFT JOIN (
          SELECT DISTINCT ON ("userId") "userId", "createdAt"
          FROM "ActivityLog"
          ORDER BY "userId", "createdAt" DESC
        ) last ON last."userId" = u.id
        ${searchWhere}
        ORDER BY last."createdAt" ${directionSql}, u.id ASC
        LIMIT ${limit} OFFSET ${skip}
      `
      orderedUserIds = rows.map((r) => r.id)
    }

    total = await prisma.user.count({ where })
  } else {
    // Plain DB column — let Prisma sort + paginate directly.
    const orderBy = { [sortField]: sortOrder } as
      | { name: "asc" | "desc" }
      | { email: "asc" | "desc" }
      | { createdAt: "asc" | "desc" }
    const [rows, count] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])
    orderedUserIds = rows.map((r) => r.id)
    total = count
  }

  // Short-circuit when there's nothing on this page (e.g. past last page).
  if (orderedUserIds.length === 0) {
    return NextResponse.json({
      users: [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }

  // Step 2: fetch full user records for the selected IDs.
  // `findMany` doesn't preserve the order of `id: { in: ... }`, so we
  // reassemble against `orderedUserIds` below.
  const users = await prisma.user.findMany({
    where: { id: { in: orderedUserIds } },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      githubId: true,
      isAdmin: true,
      isPro: true,
      createdAt: true,
    },
  })

  // Step 3: enrich with message counts and last activity for these users.
  const messageCounts = await prisma.$queryRaw<Array<{ userId: string; count: bigint }>>`
    SELECT "userId", COUNT(*)::bigint as count
    FROM "ActivityLog"
    WHERE "userId" = ANY(${orderedUserIds}) AND action = 'message_sent'
    GROUP BY "userId"
  `
  const messageCountMap = new Map(messageCounts.map((c) => [c.userId, Number(c.count)]))

  const lastActivities = await prisma.activityLog.findMany({
    where: { userId: { in: orderedUserIds } },
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

  // Step 4: reassemble in the order returned by the sorted query.
  const userById = new Map(users.map((u) => [u.id, u]))
  const formattedUsers = orderedUserIds.flatMap((id) => {
    const user = userById.get(id)
    if (!user) return []
    const lastActivity = lastActivityMap.get(user.id)
    return [
      {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        githubId: user.githubId,
        isAdmin: user.isAdmin,
        isPro: user.isPro,
        totalMessages: messageCountMap.get(user.id) ?? 0,
        lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
        lastActivityAction: lastActivity?.action ?? null,
        createdAt: user.createdAt.toISOString(),
      },
    ]
  })

  return NextResponse.json({
    users: formattedUsers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
