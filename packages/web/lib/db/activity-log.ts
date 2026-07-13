import { Prisma } from "@prisma/client"
import { classifyAgentError } from "@background-agents/sdk"
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
  | "daily_limit_reached"
  // An LLM provider/model call failed for a turn (auth, balance, rate limit,
  // model unavailable, network, or an otherwise-unclassified model error).
  | "llm_provider_error"

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
  // llm_provider_error fields:
  /** Coarse failure category from the SDK classifier. */
  category?: string
  /** Where the failure was observed (live stream vs. one of the crons). */
  source?: string
  /** The (truncated) user-facing error string. */
  message?: string
  /** Scheduled-job run id, when the failure came from a scheduled run. */
  jobRunId?: string
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

/** Cap the error string we persist/print — provider errors can be large JSON. */
const LLM_ERROR_MSG_MAX = 500

export interface LlmProviderErrorContext {
  userId: string
  agent?: string
  model?: string | null
  chatId?: string
  jobRunId?: string
  /** Where the failure was observed. */
  source: "stream" | "cron-interactive" | "cron-scheduled"
  /** The user-facing error string from the agent snapshot. */
  error: string
  /**
   * The snapshot's errorKind, if any. "crash"/"incomplete" are process- or
   * stream-level failures rather than the provider failing.
   */
  errorKind?: "crash" | "incomplete"
}

/**
 * Record an LLM provider/model failure for observability.
 *
 * Motivation: we previously had NO visibility into provider failures. When a
 * model started failing (auth, insufficient balance, rate limit, unavailable
 * model, network) the turn surfaced an error to the one user and vanished —
 * nothing aggregate to look at. This records each such failure in two places:
 *
 *   1. A structured `console.error("[llm-provider-error]", …)` line — immediate,
 *      greppable visibility in the server/Vercel logs.
 *   2. An ActivityLog row (action "llm_provider_error") — durable and queryable
 *      in the admin activity view, filterable by action.
 *
 * Bare process crashes / incomplete streams are skipped unless the captured
 * detail actually classifies as a provider category (e.g. a crash whose
 * captured stderr is an auth failure), since those are infra failures rather
 * than the provider itself failing.
 */
export function logLlmProviderError(ctx: LlmProviderErrorContext): void {
  const { category } = classifyAgentError(ctx.error)

  // Filter out non-provider process/stream failures.
  if (ctx.errorKind && category === "unknown") return

  const message =
    ctx.error.length > LLM_ERROR_MSG_MAX
      ? `${ctx.error.slice(0, LLM_ERROR_MSG_MAX)}…`
      : ctx.error

  const metadata: ActivityMetadata = {
    category,
    agent: ctx.agent,
    model: ctx.model ?? undefined,
    source: ctx.source,
    chatId: ctx.chatId,
    jobRunId: ctx.jobRunId,
    message,
  }

  console.error("[llm-provider-error]", JSON.stringify({ userId: ctx.userId, ...metadata }))
  logActivityAsync(ctx.userId, "llm_provider_error", metadata)
}
