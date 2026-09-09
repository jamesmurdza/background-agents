/**
 * Gating for the shared credential pools.
 *
 * Free and Pro are gated purely on purchased credits now: a run is allowed
 * while `creditBalanceMicroUsd > 0`, full stop, whatever the plan. There is no
 * separate free daily tier to fall back on any more, and Free/Pro are
 * therefore identical here. Only `unlimited`-plan users, and anyone running on
 * their own key, are uncapped.
 *
 * Because a turn's cost is only known after it runs, enforcement is post-hoc:
 * we block the NEXT turn once the balance has hit zero. That means one turn
 * can overshoot — a single agentic run has been observed at $476 — and
 * nothing here bounds that; the overshoot is recorded as a negative balance,
 * which then blocks the account until a top-up clears it. Credits never
 * expire or reset on their own.
 *
 * The daily-allowance machinery (`getDailyBalance`, `sumSharedSpend` since UTC
 * midnight) is kept and still computed below — `used`/`limit`/`remaining` feed
 * the Settings usage bar and are used elsewhere for manual/bonus credit
 * grants — but it no longer decides whether a turn is allowed. We are not
 * managing a separate free-credit pool any more.
 */

import { modelRequiresKey, type Agent, type ProviderName } from "@background-agents/common"

import { prisma } from "./prisma"
import { sumSharedSpend } from "./token-usage"
import { providerForRun, resolvePool } from "@/lib/server/shared-pool"
import { decryptUserCredentials } from "./api-helpers"
import { getMultiplierFor } from "./provider-pricing"
import { formatUsageLimitMessage } from "@/lib/usage-limit-copy"
import { isFreeMultiplier, microToUsd } from "@/lib/server/credits"
import {
  getDailyBalance,
  getNextUtcDayReset,
  getStartOfUtcDay,
  type Plan,
} from "@/lib/server/usage-budgets"

export interface UsageLimitResult {
  allowed: boolean
  plan: Plan
  /** Provider this run would have been billed to — for logging and telemetry. */
  provider: ProviderName
  /** "shared" pools draw the balance; "user" pools are always allowed. */
  pool: "shared" | "user"
  /** Spent today, across every shared pool. */
  used: number
  /** Daily balance (Free/Pro), or null for Unlimited/own-key runs. */
  limit: number | null
  remaining: number | null
  /**
   * Purchased credits, in USD. Negative when the turn that emptied the balance
   * overshot it. Reported as a number, not the stored BigInt, because this
   * result is serialised straight into a JSON response.
   */
  creditBalance: number
  resetAt: Date
  error?: string
}

/**
 * Check whether a user may start a turn on `agent` given their purchased
 * credit balance. Uncapped (allowed, no limit) when: the agent has no shared
 * pool, the user supplied their own key for it, or the user is on the
 * `unlimited` plan. Free and Pro both require `creditBalance > 0` — they are
 * treated identically here.
 *
 * Note the asymmetry, and that it is deliberate: whether *this* run is metered
 * depends on the agent and model being used right now, but how much has been
 * *spent* is pooled across every shared provider. So a user who spent their
 * balance on Claude is blocked on Gemini too — unless they have their own
 * Gemini key, in which case this run resolves to the "user" pool and is allowed.
 */
export async function checkSharedPoolUsage(
  userId: string,
  agent: Agent,
  model?: string
): Promise<UsageLimitResult> {
  const provider = providerForRun(agent, model)
  const resetAt = getNextUtcDayReset()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, credentials: true, creditBalanceMicroUsd: true },
  })

  const plan: Plan = user?.plan ?? "free"
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )
  // resolvePool folds in the model: custom endpoints and own-key runs read as
  // "user" (never limited), and a Gemini model under a BYOK agent (Pi, Droid)
  // reads as the shared Gemini pool.
  const pool = resolvePool(agent, storedCreds, model)

  const credits = user?.creditBalanceMicroUsd ?? 0n
  const creditBalance = microToUsd(credits)

  const base = { plan, provider, pool, used: 0, creditBalance, resetAt }

  // Not a shared-pool run → uncapped. resolvePool returns "shared" only for a
  // genuine shared-pool run (incl. a Gemini model under Pi/Droid), so gating on
  // the resolved pool covers every case without an agent allowlist.
  if (pool === "user") {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  // A model that needs no credential costs the platform nothing and is already
  // excluded from the balance sum (freeModel), so it stays available at zero.
  // This mirrors the first line of hasCredentialsForModel, which is what keeps
  // the picker and the send path in agreement: without it the UI offers
  // OpenCode's free tier as the way out of a spent balance and the server then
  // rejects it — including the "Continue with OpenCode" retry, which would loop
  // straight back into a 429.
  //
  // Checked via requiresKey rather than isFreeModel: that helper matches
  // tokscale's bare ids at write time and misses "opencode/big-pickle", which
  // has no -free suffix.
  if (modelRequiresKey(agent, model) === "none") {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  // A provider an admin has set to a 0 multiplier (see lib/db/provider-pricing
  // and the /admin Pricing panel) is free the same way a no-key model is: it
  // never draws the balance, so it must never block on one either. Without
  // this, chargeTurnToCredits would already charge nothing for the run — but
  // the gate above would still refuse to start it on a spent balance, since it
  // has no other concept of "this provider is free" to check.
  if (isFreeMultiplier(await getMultiplierFor(provider))) {
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  const allowance = getDailyBalance(plan)
  if (allowance == null) {
    // Unlimited plan ⇒ uncapped, and never touches credits either.
    return { ...base, allowed: true, limit: null, remaining: null }
  }

  // Still computed for display (the Settings usage bar) and for anything else
  // that wants to know today's spend, but no longer part of the allow/deny
  // decision below.
  const used = await sumSharedSpend({ userId, since: getStartOfUtcDay() })
  const remaining = Math.max(0, allowance - used)

  // Any balance above zero is enough to start one more turn. Strictly above —
  // a balance of exactly zero, or a negative one left by a turn that
  // overshot, refuses. Since a turn's cost is only known after it runs, this
  // is the whole of the overshoot policy: one turn may exceed whatever was
  // left, and the deficit it writes then blocks the account until a top-up
  // clears it.
  const allowed = credits > 0n

  return {
    ...base,
    allowed,
    used,
    limit: allowance,
    remaining,
    error: allowed ? undefined : formatUsageLimitMessage({ creditBalance }),
  }
}

/**
 * Thrown when a run is refused because the daily balance is spent.
 *
 * Used by the scheduled-job path, which has no request to answer with a 429:
 * the starter throws this and the cron turns it into a failed run record
 * without counting it against the job's consecutive-failure budget (a spent
 * balance is not the job misbehaving, and it clears at UTC midnight).
 */
export class UsageLimitError extends Error {
  readonly usage: UsageLimitResult

  constructor(usage: UsageLimitResult) {
    super(usage.error ?? "Daily limit reached")
    this.name = "UsageLimitError"
    this.usage = usage
  }
}
