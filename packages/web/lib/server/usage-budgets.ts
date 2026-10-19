/**
 * The daily spending balance for the shared credential pools.
 *
 * One balance, spent across every shared pool. It is denominated in US dollars of
 * published API list value — the same figure the ledger already stores in
 * `TokenUsage.costUsd`, priced from Anthropic's rates for Claude (see
 * lib/server/claude-pricing) and from tokscale for everything else.
 *
 * It is deliberately NOT a dollar anyone paid: Claude runs on a flat Max 20x
 * subscription, so the number is notional value, exactly as the admin dashboard
 * labels it. Keeping the meter denominated in list value means the only question
 * it has to answer is "what would these tokens have cost", which has a checkable
 * answer.
 *
 * Why one pooled allowance instead of a budget per provider:
 *   - Three budgets in three units (USD, USD, messages) gave three different
 *     answers to "how much do I have left", and a user who exhausted one could
 *     simply move to another. One number is both honest and unroutable-around.
 *   - Claude is ~98% of the draw, so pooling costs almost nothing. Replayed over
 *     1,194 user-days (Jun–Sep 2026) the pooled rule allowed $7,150 against
 *     $7,185 under the old per-provider rules — a $35 difference, and exactly
 *     one additional capped user-day.
 *
 * Free models are excluded entirely (see isFreeModel), so a user with nothing
 * left can still work on OpenCode's free tier. That is the intended floor.
 *
 * Enforcement is post-hoc: a turn's cost is only knowable once it has run, so
 * spending is checked before the NEXT turn. One turn can therefore overshoot —
 * see lib/db/usage-limit.
 */

import type { ProviderName } from "@background-agents/common"

/**
 * Shared pools that draw on the daily balance.
 *
 * A run only counts when it actually used the server's credential — rows are
 * stamped `pool: "shared"` at write time — so a user on their own key is never
 * charged, even for a provider listed here.
 */
export const BALANCE_POOL_PROVIDERS: readonly ProviderName[] = [
  "claude",
  "opencode",
  "gemini",
]

/**
 * Daily balance, in USD of API list value.
 *
 * Sized from the ledger, not modelled. Over 77 active days (Jun–Aug 2026): 106
 * users, 6,463 shared turns, $14,846 of value — ~$193/day at ~11.9 users active
 * per day, averaging $2.30 a turn. Note a "turn" here is a whole agentic run
 * (many API round-trips, each re-reading cache), not a single call, which is why
 * it costs orders of magnitude more than a chat message.
 *
 * Cost per user-day was distributed:  p50 $8.37 · p75 $17.26 · p90 $42.55 ·
 * max $237.39. The tail is the problem this cap exists to solve — 8 of those 106
 * users accounted for 75% of all spend, and left alone they crowd everyone else
 * out as the pool grows.
 *
 * The 100k-token cap this ultimately replaces was worth a median of $8.10 of
 * real value per user-day — but anywhere from $4.80 (p25) to $26.78 (p90),
 * because the same token allowance buys wildly different amounts depending on
 * the model. That spread is why a token cap never controlled the pool: we were
 * hitting the subscription's weekly limit (77 times in that window, plus 57
 * Fable-specific and 26 session limits) while the cap looked like it was holding.
 *
 * $5/day sits below that $8.10 median, so it is a genuine tightening.
 *
 * What this does NOT bound: the pool as a whole. This caps a single user; 200
 * users active at once is still 200× the balance. A pool-wide daily ceiling is
 * the only hard bound, and it does not exist yet.
 */
const DAILY_BALANCE = 5

/**
 * A temporary boost to the balance, with a hard expiry.
 *
 * While live, the multiplier scales the daily balance. At `until` the boost
 * lapses on its own and the baseline returns; nothing has to be changed back by
 * hand.
 */
interface BalanceBoost {
  multiplier: number
  /** Instant the boost stops applying (exclusive). */
  until: Date
}

/**
 * The live boost, or null.
 *
 * No boost is currently live — the pool runs on its $5 baseline. Set an object
 * here (with a hard `until` expiry) to temporarily scale the balance; one whose
 * `until` is in the past is inert.
 */
export const BALANCE_BOOST: BalanceBoost | null = null

/** The boost multiplier at `now` — 1 when no boost is live. */
function getBoostMultiplier(now: Date): number {
  if (!BALANCE_BOOST || now >= BALANCE_BOOST.until) return 1
  return BALANCE_BOOST.multiplier
}

/** Daily balance, scaled by any live {@link BALANCE_BOOST}. */
export function getDailyBalance(now: Date = new Date()): number {
  return DAILY_BALANCE * getBoostMultiplier(now)
}

/**
 * Free models (mostly OpenCode's free tier) that must NOT draw the balance.
 * They're still recorded in the ledger (so they appear in overall totals), just
 * flagged `freeModel=true` and excluded from the balance sum — which is what
 * leaves them usable once a user's allowance is spent.
 *
 * Matching is by tokscale's `model` id: this explicit set OR a `-free`/`:free`
 * suffix (the common convention) — so new free models are auto-caught.
 */
const FREE_MODELS: ReadonlySet<string> = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free",
])

/** Whether a model is free (never draws the balance). */
export function isFreeModel(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return FREE_MODELS.has(m) || m.endsWith("-free") || m.endsWith(":free")
}

/** Start of the current UTC day (the balance window start). */
export function getStartOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

/** Next UTC midnight (when the balance resets). */
export function getNextUtcDayReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
}
