import { fmtBalance } from "@/lib/format"

/**
 * The message shown when a user has nothing left to spend.
 *
 * Gating is purely credit-based (see lib/db/usage-limit): there are no tiers
 * and no separate free daily allowance to fall back on, so this is always
 * about credits.
 *
 * Deliberately names no provider: the balance is pooled, so "your Claude limit"
 * was both wrong and confusing once the same allowance covered Gemini and
 * OpenCode. Free models are called out because they genuinely still work — they
 * never draw down the balance — and that is the most useful thing a blocked user
 * can be told.
 *
 * Topping up leads the list of next steps now that it exists: it is the only
 * one the user can act on immediately and alone. Adding an API key means
 * having one.
 */
export function formatUsageLimitMessage({
  creditBalance = 0,
}: {
  /**
   * Purchased credits in USD. Negative when the turn that emptied them
   * overshot — a cost is only known once the turn has run.
   */
  creditBalance?: number
}): string {
  // A deficit is the one case worth calling out specifically: the amount to
  // clear is more than "zero", so say so plainly.
  if (creditBalance < 0) {
    return (
      `Your last turn ran ${fmtBalance(Math.abs(creditBalance))} past your credits. ` +
      `Top up to clear it, add your own API key, or switch to a free model — ` +
      `your daily credits will also chip away at it.`
    )
  }

  return (
    "You're out of credits. Top up to continue, add your own API key, " +
    "switch to a free model, or come back tomorrow for your daily credit."
  )
}
