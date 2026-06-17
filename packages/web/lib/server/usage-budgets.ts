/**
 * Per-provider daily budgets for the shared credential pools.
 *
 * Budgets scale by plan: `free` gets the base daily budget, `pro` gets 2× that
 * budget (still daily), and `unlimited` is uncapped. The budget *unit* differs
 * by provider — each pool is metered in whatever measure best reflects its cost:
 *   - claude   → "tokens": cache-excluded limited tokens (input + output +
 *                reasoning; see UsageTotals.limitedTokens).
 *   - opencode → "cost": USD spend (tokscale's per-turn cost), since OpenCode
 *                spans many models with wildly different per-token prices.
 *   - gemini   → "messages": number of assistant turns, a simple message cap.
 *
 * NOTE: numbers below are PLACEHOLDERS. Tune them once real usage has been
 * logged to the TokenUsage ledger. Omit a provider to leave it unlimited.
 */

import type { ProviderName } from "@background-agents/common"

/** Subscription tier (mirrors Prisma's `Plan` enum). */
export type Plan = "free" | "pro" | "unlimited"

/** Unit a provider's shared-pool budget is measured in. */
export type BudgetUnit = "tokens" | "cost" | "messages"

export interface ProviderBudget {
  unit: BudgetUnit
  /** Daily allowance in the unit: tokens, USD, or message count. */
  limit: number
}

/** Multiplier applied to the free daily budget for `pro` users. */
export const PRO_BUDGET_MULTIPLIER = 2

/** Free-tier daily budget per shared-pool provider, with its unit. */
export const FREE_DAILY_BUDGETS: Partial<Record<ProviderName, ProviderBudget>> = {
  // TODO(token-budgets): replace placeholders with tuned values.
  claude: { unit: "tokens", limit: 100_000 },
  opencode: { unit: "cost", limit: 0.5 },
  gemini: { unit: "messages", limit: 100 },
}

/**
 * Daily budget descriptor for a provider on a given plan, or null when
 * unlimited (the `unlimited` plan, or a provider with no configured budget).
 * `pro` gets `PRO_BUDGET_MULTIPLIER`× the free budget; `free` gets the base.
 */
export function getProviderBudget(
  provider: ProviderName,
  plan: Plan = "free"
): ProviderBudget | null {
  if (plan === "unlimited") return null
  const base = FREE_DAILY_BUDGETS[provider]
  if (!base) return null
  if (plan === "pro") {
    return { unit: base.unit, limit: base.limit * PRO_BUDGET_MULTIPLIER }
  }
  return base
}

/**
 * Daily token budget for a provider on a given plan, or null when the provider
 * isn't metered in tokens (cost/message-based) or is unlimited. Used by the
 * Claude-specific limit display in credential-flags.
 */
export function getDailyTokenBudget(
  provider: ProviderName,
  plan: Plan = "free"
): number | null {
  const b = getProviderBudget(provider, plan)
  return b && b.unit === "tokens" ? b.limit : null
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
