/**
 * Token-based usage limits for the shared credential pools.
 *
 * Free users get a daily, per-provider, cache-excluded token budget when using
 * a shared pool (Claude OAuth / Gemini / OpenCode server keys). Users running on
 * their own key, and Pro users, are unlimited. Usage is summed from the
 * TokenUsage ledger (populated post-turn by tokscale metering).
 *
 * Because a turn's token cost is only known after it runs, enforcement is
 * post-hoc: we block the NEXT turn once the period's usage has met the budget.
 */

import type { Agent, ProviderName } from "@background-agents/common"

import { prisma } from "./prisma"
import { sumSharedUsage } from "./token-usage"
import { isSharedPoolAgent, providerForAgent, resolvePool } from "@/lib/server/shared-pool"
import { decryptUserCredentials } from "./api-helpers"
import {
  getDailyTokenBudget,
  getNextUtcDayReset,
  getStartOfUtcDay,
} from "@/lib/server/usage-budgets"

export interface UsageLimitResult {
  allowed: boolean
  isPro: boolean
  provider: ProviderName
  /** "shared" pools are limited; "user" pools are always allowed. */
  pool: "shared" | "user"
  /** Cache-excluded tokens used in the current period. */
  used: number
  /** Daily token budget (free users), or null when unlimited (pro/own key). */
  limit: number | null
  remaining: number | null
  resetAt: Date
  error?: string
}

/**
 * Check whether a user may start a turn on `agent` given the shared-pool token
 * budget. Unlimited (allowed, no limit) when: the agent has no shared pool, the
 * user supplied their own key for it, or the user is Pro.
 */
export async function checkSharedPoolUsage(
  userId: string,
  agent: Agent
): Promise<UsageLimitResult> {
  const provider = providerForAgent(agent)
  const resetAt = getNextUtcDayReset()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPro: true, credentials: true },
  })

  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )
  const pool = resolvePool(agent, storedCreds)

  const base = {
    isPro: user?.isPro ?? false,
    provider,
    pool,
    used: 0,
    resetAt,
  }

  // Not a shared-pool run → unlimited.
  if (!isSharedPoolAgent(agent) || pool === "user") {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  // Pro users: unlimited on shared pools.
  if (base.isPro) {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const budget = getDailyTokenBudget(provider)
  if (budget == null) {
    // No configured budget ⇒ effectively unlimited.
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const { limitedTokens } = await sumSharedUsage({
    userId,
    provider,
    since: getStartOfUtcDay(),
  })

  const remaining = Math.max(0, budget - limitedTokens)
  const allowed = limitedTokens < budget

  return {
    ...base,
    allowed,
    used: limitedTokens,
    limit: budget,
    remaining,
    error: allowed
      ? undefined
      : `Daily ${provider} token limit reached (${budget.toLocaleString()} tokens). ` +
        `Upgrade to Pro for unlimited usage, or add your own ${provider} key.`,
  }
}
