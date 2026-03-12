import { prisma } from "@/lib/prisma"
import { BRANCH_STATUS } from "@/lib/constants"

const MAX_CONCURRENT_SANDBOXES = 10

// Statuses that count toward the active sandbox quota
const ACTIVE_STATUSES = [BRANCH_STATUS.CREATING, BRANCH_STATUS.RUNNING, BRANCH_STATUS.STOPPED]

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  current: number
  max: number
}> {
  const activeSandboxes = await prisma.sandbox.count({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
  })

  return {
    allowed: activeSandboxes < MAX_CONCURRENT_SANDBOXES,
    current: activeSandboxes,
    max: MAX_CONCURRENT_SANDBOXES,
  }
}

export async function getQuota(userId: string) {
  const activeSandboxes = await prisma.sandbox.count({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
  })

  return {
    current: activeSandboxes,
    max: MAX_CONCURRENT_SANDBOXES,
    remaining: Math.max(0, MAX_CONCURRENT_SANDBOXES - activeSandboxes),
  }
}
