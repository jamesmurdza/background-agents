import { prisma } from "@/lib/prisma"
import { requireAdmin, isAuthError } from "@/lib/api-helpers"
import { BRANCH_STATUS } from "@/lib/constants"

const ACTIVE_STATUSES = [BRANCH_STATUS.CREATING, BRANCH_STATUS.RUNNING, BRANCH_STATUS.STOPPED]

export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  // Get current date boundaries
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - 7)

  // Run all queries in parallel
  const [
    totalUsers,
    activeSandboxes,
    sandboxesCreatedToday,
    sandboxesCreatedThisWeek,
    agentExecutionsToday,
    agentExecutionsThisWeek,
    recentActivity,
  ] = await Promise.all([
    // Total users
    prisma.user.count(),

    // Currently active sandboxes
    prisma.sandbox.count({
      where: { status: { in: ACTIVE_STATUSES } },
    }),

    // Sandboxes created today (from activity log)
    prisma.activityLog.count({
      where: {
        action: "sandbox_created",
        createdAt: { gte: startOfToday },
      },
    }),

    // Sandboxes created this week
    prisma.activityLog.count({
      where: {
        action: "sandbox_created",
        createdAt: { gte: startOfWeek },
      },
    }),

    // Agent executions today
    prisma.activityLog.count({
      where: {
        action: "agent_executed",
        createdAt: { gte: startOfToday },
      },
    }),

    // Agent executions this week
    prisma.activityLog.count({
      where: {
        action: "agent_executed",
        createdAt: { gte: startOfWeek },
      },
    }),

    // Recent activity (last 50 entries)
    prisma.activityLog.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        action: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ])

  return Response.json({
    stats: {
      totalUsers,
      activeSandboxes,
      sandboxesCreatedToday,
      sandboxesCreatedThisWeek,
      agentExecutionsToday,
      agentExecutionsThisWeek,
    },
    recentActivity,
  })
}
