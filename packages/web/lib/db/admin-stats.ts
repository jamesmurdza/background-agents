import { prisma } from "@/lib/db/prisma"

export interface TopUser {
  name: string
  image: string | null
  messageCount: number
  chatCount: number
}

/**
 * Top active users (by message count) within the given interval.
 *
 * Reads from ActivityLog so that users with deleted chats are still counted.
 *
 * @param interval - Postgres interval string, e.g. "30 days" or "24 hours".
 * @param excludeAdmins - When true, admin users are omitted from the results.
 */
export async function getTopUsers(
  interval: string,
  excludeAdmins: boolean
): Promise<TopUser[]> {
  const rows = await prisma.$queryRaw<
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
      AND (${excludeAdmins} = false OR u."isAdmin" = false)
    ORDER BY "messageCount" DESC
    LIMIT 10
  `

  return rows.map((item) => ({
    name: item.name || "Unknown",
    image: item.image,
    messageCount: Number(item.messageCount),
    chatCount: Number(item.chatCount),
  }))
}
