/**
 * Token-based usage limits for the shared credential pools.
 *
 * Free users get a daily, per-provider, cache-excluded token budget when using
 * a shared pool (Claude OAuth / Gemini / OpenCode server keys). Pro users get
 * the same daily budget scaled by PRO_BUDGET_MULTIPLIER; only `unlimited`-plan
 * users (and anyone running on their own key) are uncapped. Usage is summed from
 * the TokenUsage ledger (populated post-turn by tokscale metering).
 *
 * Because a turn's token cost is only known after it runs, enforcement is
 * post-hoc: we block the NEXT turn once the period's usage has met the budget.
 */

import type { Agent, ProviderName } from "@background-agents/common"

import { prisma } from "./prisma"
import { sumSharedUsage, countSharedMessages } from "./token-usage"
import { isSharedPoolAgent, providerForAgent, resolvePool } from "@/lib/server/shared-pool"
import { decryptUserCredentials } from "./api-helpers"
import {
  getProviderBudget,
  getNextUtcDayReset,
  getStartOfUtcDay,
  type BudgetUnit,
  type Plan,
} from "@/lib/server/usage-budgets"

export interface UsageLimitResult {
  allowed: boolean
  plan: Plan
  provider: ProviderName
  /** "shared" pools are limited; "user" pools are always allowed. */
  pool: "shared" | "user"
  /** Unit the budget is measured in: tokens, USD cost, or message count. */
  unit: BudgetUnit
  /** Amount used in the current period, in `unit` (tokens / USD / messages). */
  used: number
  /** Daily budget in `unit` (free users), or null when unlimited (pro/own key). */
  limit: number | null
  remaining: number | null
  resetAt: Date
  error?: string
}

/**
 * Check whether a user may start a turn on `agent` given the shared-pool token
 * budget. Unlimited (allowed, no limit) when: the agent has no shared pool, the
 * user supplied their own key for it, or the user is on the `unlimited` plan.
 * Free and Pro users are capped (Pro at PRO_BUDGET_MULTIPLIER× the free budget).
 */
export async function checkSharedPoolUsage(
  userId: string,
  agent: Agent
): Promise<UsageLimitResult> {
  const provider = providerForAgent(agent)
  const resetAt = getNextUtcDayReset()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, credentials: true },
  })

  const plan: Plan = user?.plan ?? "free"
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )
  const pool = resolvePool(agent, storedCreds)

  const budget = getProviderBudget(provider, plan)

  const base = {
    plan,
    provider,
    pool,
    unit: budget?.unit ?? ("tokens" as BudgetUnit),
    used: 0,
    resetAt,
  }

  // Not a shared-pool run → unlimited.
  if (!isSharedPoolAgent(agent) || pool === "user") {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  if (budget == null) {
    // Unlimited plan, or a provider with no configured budget ⇒ unlimited.
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const since = getStartOfUtcDay()
  const used = await getSharedUsage(userId, provider, budget.unit, since)

  const remaining = Math.max(0, budget.limit - used)
  const allowed = used < budget.limit

  return {
    ...base,
    unit: budget.unit,
    allowed,
    used,
    limit: budget.limit,
    remaining,
    error: allowed ? undefined : limitMessage(provider, budget.unit, budget.limit),
  }
}

/** Usage in the period, measured in the provider's budget unit. */
async function getSharedUsage(
  userId: string,
  provider: ProviderName,
  unit: BudgetUnit,
  since: Date
): Promise<number> {
  if (unit === "messages") {
    return countSharedMessages({ userId, provider, since })
  }
  const { limitedTokens, costUsd } = await sumSharedUsage({ userId, provider, since })
  return unit === "cost" ? costUsd : limitedTokens
}

/** Human-readable limit message, phrased per unit. */
function limitMessage(provider: ProviderName, unit: BudgetUnit, limit: number): string {
  const allowance =
    unit === "tokens"
      ? `${limit.toLocaleString()} tokens`
      : unit === "cost"
        ? `$${limit.toFixed(2)}`
        : `${limit.toLocaleString()} messages`
  return (
    `Daily ${provider} limit reached (${allowance}). ` +
    `Upgrade to Pro for unlimited usage, or add your own ${provider} key.`
  )
}
