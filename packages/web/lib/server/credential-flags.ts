/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { hasExceededClaudeLimit, getDailyClaudeCodeLimit } from "@/lib/db/usage-limit"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import { flagsFromCredentials, CREDENTIAL_KEYS, type CredentialFlags } from "@/lib/credentials"

export interface EffectiveFlags {
  flags: CredentialFlags
  limitResetAt: Date | null
  limitRemaining: number | null
  /** Number of shared Claude messages used in current period (daily for free, weekly for pro) */
  limitUsed: number | null
  /** Daily limit (10 for free users, null for pro/unlimited) */
  limitTotal: number | null
  /** Whether usage is tracked weekly (pro) vs daily (free) */
  isWeekly: boolean
  /** Whether user is a pro subscriber */
  isPro: boolean
}

/**
 * Build effective credential flags for a user, including the daily Claude limit status.
 *
 * This is the single entry point for server-side flag resolution. It combines:
 * - Stored credentials
 * - Shared pool availability
 * - Daily limit check (only for free users using shared credentials)
 *
 * The resulting flags can be passed directly to getDefaultAgent/hasCredentialsForModel.
 */
export async function getEffectiveCredentialFlags(userId: string): Promise<EffectiveFlags> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentials: true, isPro: true },
  })

  const decryptedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )

  // Fallback: check process.env for any missing credentials
  for (const { id } of CREDENTIAL_KEYS) {
    if (!decryptedCreds[id] && process.env[id]) {
      decryptedCreds[id] = process.env[id]
    }
  }

  const flags = flagsFromCredentials(decryptedCreds)

  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  // Check daily limit only for free users who would use the shared pool
  // (no personal API key or subscription token)
  const hasOwnAnthropicKey = !!flags.ANTHROPIC_API_KEY || !!flags.CLAUDE_CODE_CREDENTIALS
  const usesSharedPool = flags.CLAUDE_SHARED_POOL_AVAILABLE && !hasOwnAnthropicKey
  const isPro = user?.isPro ?? false

  let limitResetAt: Date | null = null
  let limitRemaining: number | null = null
  let limitUsed: number | null = null
  let limitTotal: number | null = null
  let isWeekly = false

  if (usesSharedPool) {
    const now = new Date()

    if (isPro) {
      // Pro users: track weekly usage (week starts Monday 00:00 UTC)
      isWeekly = true
      const dayOfWeek = now.getUTCDay() // 0 = Sunday, 1 = Monday, ...
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      const startOfWeek = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysSinceMonday
      ))

      const weekCount = await prisma.activityLog.count({
        where: {
          userId,
          action: "message_sent",
          createdAt: { gte: startOfWeek },
          metadata: { path: ["useSharedClaude"], equals: true },
        },
      })

      limitUsed = weekCount
      // Reset at next Monday 00:00 UTC
      limitResetAt = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
      // Pro users: limitTotal and limitRemaining stay null (unlimited)
    } else {
      // Free users: track daily usage
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const todayCount = await prisma.activityLog.count({
        where: {
          userId,
          action: "message_sent",
          createdAt: { gte: startOfDay },
          metadata: { path: ["useSharedClaude"], equals: true },
        },
      })

      limitUsed = todayCount
      limitResetAt = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

      // Free users have a daily limit
      const dailyLimit = getDailyClaudeCodeLimit()
      limitTotal = dailyLimit
      limitRemaining = Math.max(0, dailyLimit - todayCount)

      const exceeded = todayCount >= dailyLimit
      flags.CLAUDE_DAILY_LIMIT_EXCEEDED = exceeded
    }
  }

  return { flags, limitResetAt, limitRemaining, limitUsed, limitTotal, isPro, isWeekly }
}
