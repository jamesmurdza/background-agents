import { requireAuth, isAuthError, internalError, decryptUserCredentials } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { sumSharedUsage } from "@/lib/db/token-usage"
import {
  SHARED_POOL_AGENTS,
  providerForAgent,
  resolvePool,
} from "@/lib/server/shared-pool"
import { getDailyTokenBudget, getStartOfUtcDay, getNextUtcDayReset } from "@/lib/server/usage-budgets"
import { agentLabels, type Agent } from "@background-agents/common"

/** Per-pool usage for one shared provider, for today (UTC). */
export interface PoolUsage {
  agent: Agent
  provider: string
  label: string
  /** Cache-excluded tokens used from the shared pool today (the limited measure). */
  used: number
  /** Estimated cost (USD) of today's shared-pool usage for this provider. */
  costUsd: number
  /** Daily token budget, or null when unlimited (Pro, own key, or no budget). */
  limit: number | null
  /** True when the user has their own key for this provider (shared pool unused). */
  ownKey: boolean
}

export interface UsageResponse {
  isPro: boolean
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
      select: { isPro: true, credentials: true },
    })
    const isPro = user?.isPro ?? false
    const storedCreds = decryptUserCredentials(
      user?.credentials as Record<string, unknown> | null
    )
    const since = getStartOfUtcDay()

    const pools: PoolUsage[] = await Promise.all(
      SHARED_POOL_AGENTS.map(async (agent) => {
        const provider = providerForAgent(agent)
        const ownKey = resolvePool(agent, storedCreds) === "user"
        const { limitedTokens, costUsd } = await sumSharedUsage({
          userId,
          provider,
          since,
        })
        const budget = getDailyTokenBudget(provider)
        // Unlimited when Pro, on own key, or no configured budget.
        const limit = isPro || ownKey ? null : budget
        return {
          agent,
          provider,
          label: agentLabels[agent],
          used: limitedTokens,
          costUsd,
          limit,
          ownKey,
        }
      })
    )

    const response: UsageResponse = {
      isPro,
      resetAt: getNextUtcDayReset().toISOString(),
      pools,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
