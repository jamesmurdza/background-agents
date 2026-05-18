/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { hasExceededClaudeLimit, getDailyClaudeCodeLimit } from "@/lib/db/usage-limit"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import { flagsFromCredentials, type CredentialFlags } from "@/lib/credentials"

export interface EffectiveFlags {
  flags: CredentialFlags
  limitResetAt: Date | null
  limitRemaining: number | null
  /** Number of shared Claude messages used today */
  limitUsed: number | null
  /** Daily limit (10 for free users, null for pro/unlimited) */
  limitTotal: number | null
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

  if (usesSharedPool) {
    const now = new Date()
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    // Count messages sent today using shared Claude
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

    if (!isPro) {
      // Free users have a daily limit
      const dailyLimit = getDailyClaudeCodeLimit()
      limitTotal = dailyLimit
      limitRemaining = Math.max(0, dailyLimit - todayCount)

      const exceeded = todayCount >= dailyLimit
      flags.CLAUDE_DAILY_LIMIT_EXCEEDED = exceeded
    }
    // Pro users: limitTotal and limitRemaining stay null (unlimited)
  }

  return { flags, limitResetAt, limitRemaining, limitUsed, limitTotal, isPro }
}
