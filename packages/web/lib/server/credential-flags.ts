/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { sumSharedUsage } from "@/lib/db/token-usage"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import {
  getDailyTokenBudget,
  getStartOfUtcDay,
  getNextUtcDayReset,
  getStartOfUtcWeek,
  getNextUtcWeekReset,
  type Plan,
} from "@/lib/server/usage-budgets"
import { flagsFromCredentials, CREDENTIAL_KEYS, type CredentialFlags } from "@/lib/credentials"
import { sharedClaudePoolEligible } from "@background-agents/common"

export interface EffectiveFlags {
  flags: CredentialFlags
  limitResetAt: Date | null
  /** Remaining limited tokens (cache-excluded) for free users; null = unlimited. */
  limitRemaining: number | null
  /** Limited tokens used by the shared Claude pool this period (daily capped / weekly unlimited). */
  limitUsed: number | null
  /** Daily token budget for capped plans (free/pro); null when unlimited. */
  limitTotal: number | null
  /** Whether usage is tracked weekly (unlimited plan) vs daily (free/pro) */
  isWeekly: boolean
  /** Whether the user has a paid plan (pro or unlimited) */
  isPro: boolean
  /** The user's subscription tier. */
  plan: Plan
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
    select: { credentials: true, plan: true },
  })

  // Decrypt stored credentials (only those the user has saved)
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )

  // Build the full credentials map by falling back to process.env for any
  // missing values. This map is used elsewhere (not for origin detection).
  const decryptedCreds = { ...storedCreds }
  for (const { id } of CREDENTIAL_KEYS) {
    if (!decryptedCreds[id] && process.env[id]) {
      decryptedCreds[id] = process.env[id]
    }
  }

  // Build flags from the stored (user-provided) credentials so we can
  // distinguish between user-owned keys and server-shared env keys.
  const flags = flagsFromCredentials(storedCreds)

  // Special-case: mark whether OPENCODE_API_KEY comes from the user's stored
  // credentials (user-owned) or only from the server environment (shared).
  const opencodeFromDb = !!storedCreds.OPENCODE_API_KEY
  const opencodeFromEnv = !opencodeFromDb && !!process.env.OPENCODE_API_KEY
  flags.OPENCODE_API_KEY_USER = opencodeFromDb
  flags.OPENCODE_API_KEY_SHARED = opencodeFromEnv
  // Preserve the conventional boolean presence flag for callers that expect it
  flags.OPENCODE_API_KEY = opencodeFromDb || opencodeFromEnv

  // Same for GEMINI_API_KEY: a server env key (shared pool) should make Gemini
  // show as available in the UI, not prompt for a key. Pool origin (shared vs
  // user) is still resolved separately from stored creds, so flagging the env
  // key here doesn't make it count as user-owned.
  const geminiFromDb = !!storedCreds.GEMINI_API_KEY
  const geminiFromEnv = !geminiFromDb && !!process.env.GEMINI_API_KEY
  flags.GEMINI_API_KEY_USER = geminiFromDb
  flags.GEMINI_API_KEY_SHARED = geminiFromEnv
  flags.GEMINI_API_KEY = geminiFromDb || geminiFromEnv

  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  // Check daily limit only for free users who would use the shared pool
  // (no personal API key or subscription token)
  const usesSharedPool = sharedClaudePoolEligible(flags)
  const plan: Plan = user?.plan ?? "free"
  const isPro = plan !== "free"

  let limitResetAt: Date | null = null
  let limitRemaining: number | null = null
  let limitUsed: number | null = null
  let limitTotal: number | null = null
  let isWeekly = false

  if (usesSharedPool) {
    // Limited tokens (cache-excluded) consumed from the shared Claude pool.
    if (plan === "unlimited") {
      // Unlimited plan: weekly usage for display only — no cap.
      isWeekly = true
      const { limitedTokens } = await sumSharedUsage({
        userId,
        provider: "claude",
        since: getStartOfUtcWeek(),
      })
      limitUsed = limitedTokens
      limitResetAt = getNextUtcWeekReset()
      // limitTotal / limitRemaining stay null (unlimited)
    } else {
      // Free and Pro users: daily token budget (Pro = 2× free).
      const { limitedTokens } = await sumSharedUsage({
        userId,
        provider: "claude",
        since: getStartOfUtcDay(),
      })
      limitUsed = limitedTokens
      limitResetAt = getNextUtcDayReset()

      const budget = getDailyTokenBudget("claude", plan)
      if (budget != null) {
        limitTotal = budget
        limitRemaining = Math.max(0, budget - limitedTokens)
        flags.CLAUDE_DAILY_LIMIT_EXCEEDED = limitedTokens >= budget
      }
    }
  }

  return { flags, limitResetAt, limitRemaining, limitUsed, limitTotal, isPro, isWeekly, plan }
}
