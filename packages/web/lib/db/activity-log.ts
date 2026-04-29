import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

/**
 * Activity action types for tracking user behavior
 */
export type ActivityAction =
  | "login"
  | "logout"
  | "chat_created"
  | "chat_deleted"
  | "message_sent"
  | "sandbox_created"
  | "sandbox_deleted"
  | "settings_updated"
  | "admin_promoted"
  | "admin_demoted"

/**
 * Metadata types for different actions
 */
export type ActivityMetadata = {
  chatId?: string
  repo?: string
  model?: string
  agent?: string
  targetUserId?: string
  ip?: string
  userAgent?: string
  [key: string]: unknown
}

/**
 * Log a user activity for analytics tracking
 *
 * @param userId - The ID of the user performing the action
 * @param action - The type of action being performed
 * @param metadata - Optional additional data about the action
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
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (error) {
    // Log errors but don't throw - activity logging should never break the main flow
    console.error("[ActivityLog] Failed to log activity:", {
      userId,
      action,
      error: error instanceof Error ? error.message : error,
    })
  }
}

/**
 * Log activity without awaiting - fire and forget
 * Use this when you don't want to block the response
 */
export function logActivityAsync(
  userId: string,
  action: ActivityAction,
  metadata?: ActivityMetadata
): void {
  logActivity(userId, action, metadata).catch(() => {
    // Errors already logged in logActivity
  })
}
