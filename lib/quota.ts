import { prisma } from "@/lib/prisma"
import { BRANCH_STATUS } from "@/lib/constants"

const DEFAULT_MAX_CONCURRENT_SANDBOXES = 10

// Statuses that count toward the active sandbox quota
const ACTIVE_STATUSES = [BRANCH_STATUS.CREATING, BRANCH_STATUS.RUNNING, BRANCH_STATUS.STOPPED]

/**
 * Gets the user's sandbox limit (per-user or global default)
 */
async function getUserSandboxLimit(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { maxSandboxes: true },
  })
  return user?.maxSandboxes ?? DEFAULT_MAX_CONCURRENT_SANDBOXES
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  current: number
  max: number
}> {
  const [activeSandboxes, maxSandboxes] = await Promise.all([
    prisma.sandbox.count({
      where: {
        userId,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    getUserSandboxLimit(userId),
  ])

  return {
    allowed: activeSandboxes < maxSandboxes,
    current: activeSandboxes,
    max: maxSandboxes,
  }
}

export async function getQuota(userId: string) {
  const [activeSandboxes, maxSandboxes] = await Promise.all([
    prisma.sandbox.count({
      where: {
        userId,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    getUserSandboxLimit(userId),
  ])

  return {
    current: activeSandboxes,
    max: maxSandboxes,
    remaining: Math.max(0, maxSandboxes - activeSandboxes),
  }
}
