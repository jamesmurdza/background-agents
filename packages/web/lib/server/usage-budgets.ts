/**
 * Per-provider token budgets for the shared credential pools.
 *
 * Free users get a daily cache-excluded token budget per shared pool; Pro users
 * are unlimited. The measure is "limited tokens" = input (uncached) + output +
 * reasoning (see UsageTotals.limitedTokens) — cache reads are excluded so a few
 * large cached turns don't blow the budget.
 *
 * NOTE: numbers below are PLACEHOLDERS. Tune them once real usage has been
 * logged to the TokenUsage ledger (e.g. eyeball a week of admin stats). Set a
 * provider to `null`/omit to leave it unlimited.
 */

import type { ProviderName } from "@background-agents/common"

/** Free-tier daily limited-token budget per shared-pool provider. */
export const FREE_DAILY_TOKEN_BUDGETS: Partial<Record<ProviderName, number>> = {
  // TODO(token-budgets): replace placeholders with tuned values.
  claude: 100_000,
  gemini: 300_000,
  opencode: 250_000,
}

/** Daily token budget for a provider, or null when unlimited. */
export function getDailyTokenBudget(provider: ProviderName): number | null {
  return FREE_DAILY_TOKEN_BUDGETS[provider] ?? null
}

/**
 * Free models (mostly OpenCode's free tier) that must NOT count against the
 * shared-pool budget. They're still recorded in the ledger (so they appear in
 * overall totals), just flagged `freeModel=true` and excluded from shared sums.
 *
 * Matching is by tokscale's `model` id: this explicit set OR a `-free`/`:free`
 * suffix (the common convention) — so new free models are auto-caught.
 */
export const FREE_MODELS: ReadonlySet<string> = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free",
])

/** Whether a model is free (excluded from shared-pool budgets). */
export function isFreeModel(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return FREE_MODELS.has(m) || m.endsWith("-free") || m.endsWith(":free")
}

/** Start of the current UTC day (budget window start for free users). */
export function getStartOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

/** Next UTC midnight (when the daily budget resets). */
export function getNextUtcDayReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
}

/** Start of the current ISO week (Monday 00:00 UTC) — Pro usage window. */
export function getStartOfUtcWeek(now: Date = new Date()): Date {
  const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon, …
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday
    )
  )
}

/** Next Monday 00:00 UTC. */
export function getNextUtcWeekReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000)
}
