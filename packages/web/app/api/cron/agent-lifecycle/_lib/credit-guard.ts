import { Daytona } from "@daytonaio/sdk"

import { prisma } from "@/lib/db/prisma"
import { getCreditBalance } from "@/lib/db/credits"
import { microToUsd } from "@/lib/server/credits"

import { CREDIT_GUARD_LOOKAHEAD_MINUTES, CREDIT_GUARD_MIN_RUN_MINUTES } from "./constants"
import { meterTurnNow } from "./meter-turn"

// =============================================================================
// Mid-turn credit guard
// =============================================================================
// checkSharedPoolUsage gates a turn on `credits > 0` at the moment it starts,
// and a turn's cost is only knowable once it has run — so one turn has always
// been able to spend whatever it liked. It is not theoretical: a $0.50 balance
// bought $27.80 of list value in a single 25-minute run that the hard timeout,
// not the budget, eventually stopped.
//
// This closes the gap from the other end. The lifecycle cron already visits
// every running agent once a minute holding its sandbox, so it can ask tokscale
// what the turn has spent SO FAR, bank that through the ordinary metering path,
// and stop the run once the balance can no longer cover what the next few
// minutes are likely to cost.
//
// It bounds the overshoot rather than removing it: nothing is visible during a
// turn's first ~2 minutes, and tokscale's figure lags behind the spend by up to
// another ~2 (see the constants). Worst case goes from a full 25-minute run to
// roughly three minutes of it.

/**
 * Reason recorded against a run the guard stops. Both call sites render it as
 * "Agent stopped: …", and the send gate explains what to do about it the next
 * time the user tries — see formatUsageLimitMessage.
 */
export const CREDIT_GUARD_STOP_REASON = "Ran out of credits mid-run"

/**
 * Meter a running turn and decide whether it has to be stopped.
 *
 * Returns true when the caller should tear the run down. Never throws: metering
 * is best-effort, and a guard that failed to read anything must let the run
 * continue rather than kill a healthy agent on missing data.
 */
export async function creditBudgetExhausted(params: {
  userId: string
  chatId: string
  agent: string
  sandboxId: string | null
  /** Agent CLI session id from the snapshot that just observed this turn. */
  agentSessionId: string | null | undefined
  /** `Chat.sessionId`, used when the snapshot could not supply one. */
  fallbackSessionId?: string | null
  daytona: Daytona
  /** When the current turn began — the window spend is measured over. */
  turnStartedAt: Date
  /** The owner's plan; `unlimited` never touches credits. */
  plan: string
  /** How long the turn has been running, for the blind-window gate. */
  runningMinutes: number
}): Promise<boolean> {
  const { userId, chatId, turnStartedAt } = params

  // Cheap gates first — each one avoids a sandbox round-trip. Kept here rather
  // than at the two call sites so the rule lives in one place.
  if (params.plan === "unlimited") return false
  if (params.runningMinutes < CREDIT_GUARD_MIN_RUN_MINUTES) return false

  try {
    // Bank what has been spent up to now. This is the same call the teardown
    // paths make, so the delta it writes is charged to credits exactly once and
    // the final post-turn metering only ever bills the remainder.
    await meterTurnNow(params)

    // Only debits prove this turn is actually drawing the balance:
    // chargeTurnToCredits writes them for shared-pool, non-free, budget-pool
    // rows and nothing else. So a run on the user's own key, on a free model,
    // on a provider a multiplier of 0 has made free (see lib/db/provider-pricing),
    // or on a provider with no shared pool produces none — and is left alone
    // here without this having to re-derive any of that. It is also the spend
    // figure in the unit the balance is kept in, so no pricing multiplier is
    // applied a second time.
    const debits = await prisma.creditTransaction.findMany({
      where: { userId, chatId, type: "debit", createdAt: { gte: turnStartedAt } },
      select: { amountMicroUsd: true },
    })
    if (debits.length === 0) return false

    const balance = await getCreditBalance(userId)
    if (balance <= 0n) return true

    // Rate over the whole turn, deliberately not the last two samples. Because
    // tokscale advances in steps, consecutive samples routinely differ by
    // nothing at all right in the middle of the heaviest spending — an
    // instantaneous rate reads $0/min there and would wave the run through. An
    // average over the turn cannot go blind that way. The floor keeps a turn
    // metered unusually early from projecting an absurd rate.
    const spent = debits.reduce((sum, d) => sum + microToUsd(-d.amountMicroUsd), 0)
    const elapsedMinutes = Math.max((Date.now() - turnStartedAt.getTime()) / 60_000, 1)
    const projected = (spent / elapsedMinutes) * CREDIT_GUARD_LOOKAHEAD_MINUTES

    return microToUsd(balance) < projected
  } catch (err) {
    console.error(`[agent-lifecycle] Credit guard failed for chat ${chatId}:`, err)
    return false
  }
}
