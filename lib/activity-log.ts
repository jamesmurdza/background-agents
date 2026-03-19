import { prisma } from "@/lib/prisma"

export type ActivityAction = "sandbox_created" | "sandbox_deleted" | "agent_executed"

export interface ActivityMetadata {
  repoOwner?: string
  repoName?: string
  branchName?: string
  sandboxId?: string
  agent?: string
  model?: string
  [key: string]: unknown
}

/**
 * Log a user activity for metrics tracking.
 * This is fire-and-forget - errors are logged but don't affect the main operation.
 */
export async function logActivity(
  userId: string,
  action: ActivityAction,
  metadata?: ActivityMetadata
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    })
  } catch (error) {
    // Don't let logging failures affect the main operation
    console.error("Failed to log activity:", error)
  }
}
