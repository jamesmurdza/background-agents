import { requireAuth, isAuthError, internalError, decryptUserCredentials } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { sumSharedUsage, countSharedMessages } from "@/lib/db/token-usage"
import {
  SHARED_POOL_AGENTS,
  providerForAgent,
  resolvePool,
} from "@/lib/server/shared-pool"
import {
  getProviderBudget,
  getStartOfUtcDay,
  getNextUtcDayReset,
  type BudgetUnit,
  type Plan,
} from "@/lib/server/usage-budgets"
import { agentLabels, type Agent } from "@background-agents/common"

/** Per-pool usage for one shared provider, for today (UTC). */
export interface PoolUsage {
  agent: Agent
  provider: string
  label: string
  /** Unit this pool's budget is measured in: tokens, USD cost, or messages. */
  unit: BudgetUnit
  /** Amount used from the shared pool today, in `unit`. */
  used: number
  /** Estimated cost (USD) of today's shared-pool usage for this provider. */
  costUsd: number
  /** Daily budget in `unit`, or null when unlimited (unlimited plan, own key, or no budget). */
  limit: number | null
  /** True when the user has their own key for this provider (shared pool unused). */
  ownKey: boolean
}

export interface UsageResponse {
  /** The user's subscription tier. */
  plan: Plan
  /** ISO timestamp of the next daily reset (UTC midnight). */
  resetAt: string
  pools: PoolUsage[]
}

// =============================================================================
// GET - per-provider shared-pool token usage for the current user (today)
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, credentials: true },
    })
    const plan: Plan = user?.plan ?? "free"
    const storedCreds = decryptUserCredentials(
      user?.credentials as Record<string, unknown> | null
    )
    const since = getStartOfUtcDay()

    const pools: PoolUsage[] = await Promise.all(
      SHARED_POOL_AGENTS.map(async (agent) => {
        const provider = providerForAgent(agent)
        const ownKey = resolvePool(agent, storedCreds) === "user"
        const budget = getProviderBudget(provider, plan)
        const unit = budget?.unit ?? "tokens"
        const { limitedTokens, costUsd } = await sumSharedUsage({
          userId,
          provider,
          since,
        })
        // "used" is reported in the budget's unit so the UI can render it.
        const used =
          unit === "messages"
            ? await countSharedMessages({ userId, provider, since })
            : unit === "cost"
              ? costUsd
              : limitedTokens
        // Unlimited on own key, or when the plan has no budget (unlimited plan
        // or a provider with none configured). `budget` already reflects plan.
        const limit = ownKey ? null : (budget?.limit ?? null)
        return {
          agent,
          provider,
          label: agentLabels[agent],
          unit,
          used,
          costUsd,
          limit,
          ownKey,
        }
      })
    )

    const response: UsageResponse = {
      plan,
      resetAt: getNextUtcDayReset().toISOString(),
      pools,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
