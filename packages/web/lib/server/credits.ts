/**
 * Credits: units, the grants, the shared-pool pricing multiplier, and the
 * spend split.
 *
 * Credits are the only balance that gates a send (see lib/db/usage-limit).
 * They arrive as a grant on signup, are topped up a little each day, and are
 * otherwise bought through Stripe.
 *
 * A credit is a US dollar, but it is NOT a dollar of API list value. The ledger
 * stores list value in `TokenUsage.costUsd` — what the tokens would have cost
 * at published rates — and a turn is charged that figure times its provider's
 * pricing multiplier (see {@link chargeableUsd}), an admin-editable value
 * fetched from the table behind lib/db/provider-pricing. The multiplier exists
 * because the shared pools are not bought at list: Claude runs on a flat Max
 * 20x subscription that returned ~33× its cost over the first 83 days of the
 * ledger, so billing a user list value would overcharge them by roughly that
 * factor. A multiplier of exactly 0 makes a provider free — see
 * {@link isFreeMultiplier}.
 *
 * The two numbers are kept apart rather than reconciled. `costUsd` stays list
 * value, because every admin rollup and every threshold in
 * lib/server/turn-pricing is calibrated against it and rewriting its meaning
 * would silently reinterpret all existing history. The charged figure is what
 * lands in `CreditTransaction.amountMicroUsd`, alongside the list value and the
 * multiplier in force, so a row stays explainable after the admin moves it.
 *
 * Free of database imports so the arithmetic can be unit-tested on its own,
 * mirroring lib/server/usage-cursor. The multiplier table itself lives in
 * lib/db/provider-pricing; the ledger writes live in lib/db/credits.
 *
 * Despite the `lib/server` path this module must stay importable from the
 * client: the model picker calls {@link chargeableUsd} to label the charged
 * price beside each model's list price, given the multiplier map the settings
 * endpoint fetches server-side. Keep it free of `server-only` and of anything
 * that pulls one in.
 */

import type { Plan } from "@/lib/server/usage-budgets"

/**
 * Micro-dollars per US dollar — the stored unit for balances and ledger rows.
 *
 * Not cents: a turn frequently costs less than one (`fmtBalance` renders
 * `<$0.01`, and `floorCostUsd` exists precisely for those), so rounding each
 * debit up to a cent overcharges and rounding down to zero recreates the
 * free-route-around-the-cap bug token-metering guards against. Not a float
 * either: `snapCostResidue` exists because differencing floats in this ledger
 * lands on 4e-16 instead of 0, and a balance must not accumulate that.
 */
export const MICRO_PER_USD = 1_000_000

/**
 * What a metered turn's list value is multiplied by before it reaches the
 * balance, keyed by the internal provider id (`TokenUsage.provider`). Rates
 * live in the `ProviderPricing` table now — this is just the fallback and the
 * validation around it. See lib/db/provider-pricing for the admin-editable,
 * cached read/write path (`getMultiplierFor`, `setProviderMultiplier`), which
 * is what the admin panel and the metering/gating paths actually call.
 *
 * These are the free tier's real dial, and they are expected to move. A
 * provider with no configured row charges at {@link DEFAULT_MULTIPLIER} — full
 * list value, i.e. no subsidy.
 *
 * Sized (at the values seeded into the table) against what the pools actually
 * cost us rather than picked round: Claude is a flat Max 20x subscription
 * (~33× its price in list value over the ledger's first 83 days, i.e. a
 * multiplier around 0.05), while OpenCode and Gemini are metered keys bought
 * near list, so their subsidy is deliberately much smaller (around 0.5).
 *
 * Note the interaction with {@link SIGNUP_CREDIT_USD}: the grant is denominated
 * in credits, so lowering a multiplier makes the same grant go further on that
 * provider and only that provider. And with the send gate in
 * lib/db/usage-limit: a multiplier of exactly 0 is not just cheap, it is free
 * — see {@link isFreeMultiplier}.
 */
export const DEFAULT_MULTIPLIER = 1

/**
 * Coerce a stored or looked-up multiplier to something safe to charge with.
 *
 * Falls back to {@link DEFAULT_MULTIPLIER} for a missing entry *and* for a
 * nonsensical one (negative, non-finite). A corrupt or missing value must
 * never make a turn free by accident or credit the user for running one —
 * that is the same hazard `floorCostUsd` guards in lib/server/turn-pricing,
 * one layer down. Free is only ever reached by an explicit, validated 0 (see
 * setProviderMultiplier in lib/db/provider-pricing).
 */
export function normalizeMultiplier(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MULTIPLIER
  }
  return value
}

/**
 * True when a multiplier makes a provider free: no charge reaches credits,
 * and (per lib/db/usage-limit) a send is never blocked on balance for it.
 */
export function isFreeMultiplier(multiplier: number): boolean {
  return multiplier === 0
}

/**
 * A turn's list value → what actually comes off the balance.
 *
 * `multiplier` should be the provider's current rate (see
 * `getMultiplierFor`/`getProviderMultipliers` in lib/db/provider-pricing), but
 * is re-validated here regardless — this is the boundary that must never
 * charge free or negative by accident, so it does not trust its caller.
 *
 * The inverse is `chargedUsd / multiplier` (for a nonzero multiplier), which is
 * why the multiplier is stamped on every debit row: it is the only thing that
 * makes an old charge reproducible once the admin moves it.
 */
export function chargeableUsd(listUsd: number, multiplier: number): number {
  if (!Number.isFinite(listUsd) || listUsd <= 0) return 0
  return listUsd * normalizeMultiplier(multiplier)
}

/**
 * What a new account is granted on signup, in credits.
 *
 * Kept here, next to the unit it is denominated in, so changing the figure is a
 * one-line change rather than a hunt through the auth callbacks and the backfill
 * script that both apply it. The one copy that does not follow it is the literal
 * in migration 20260905120000_backfill_signup_credits, frozen on purpose: a
 * migration records what was actually granted on the day it ran.
 *
 * Worth sizing against the multipliers seeded in `ProviderPricing` rather than
 * in the abstract. At those rates this buys roughly two Claude turns, six paid
 * OpenCode turns or nine Gemini turns, measured on the ledger's own per-turn
 * averages. It is no
 * longer the whole free tier — {@link DAILY_CREDIT_USD} refills behind it — so it
 * only has to cover a first session, not a relationship.
 */
export const SIGNUP_CREDIT_USD = 0.25

/**
 * The balance the daily cron tops an account up *to*, per plan, in credits.
 *
 * A refill to a fixed level, not a repeated addition: once a day, any balance
 * below the plan's target is raised to exactly it, and anything at or above is
 * left alone. So the grant is `target - balance`, never a flat amount, and a
 * user who buys credits is never also handed change on top.
 *
 * Setting a level rather than adding to one also makes the write naturally
 * idempotent: applying it twice lands on the same number, so a double fire can
 * only ever be a no-op, on top of the exactly-once guard the cron already has.
 *
 * Applied by the daily-credits cron, not by anything on the request path, so a
 * user who never returns costs nothing to keep topped up.
 *
 * This is what finally makes `pro` mean something — it and `free` have been
 * identical since gating moved to credits.
 *
 * `unlimited` has no target and is never refilled. It is ungated: the send check
 * short-circuits ahead of the balance and token-metering skips the charge
 * entirely, so an unlimited account neither spends credits nor needs any. A
 * target there would fund a balance nothing draws down and put a nightly row in
 * the ledger that means nothing. `null` says "not refilled" — distinct from a
 * plan this table has simply never heard of, which falls back to `free`.
 *
 * A negative balance is refilled like any other, and that is the sharp edge
 * here. The deficit left by a turn that overshot zero is cleared *in full*
 * overnight — a user at -$20 is back to their target tomorrow — which makes
 * "run one expensive turn, wait a day, repeat" free and unbounded. It is the
 * same hazard that removed the old daily allowance (a reset re-opened the gate
 * on a deficit), reintroduced deliberately and in a stronger form: the old rule
 * at least made a large deficit take many days to clear. The judgement is that
 * a permanent lockout on a free account is worse than the abuse case, and the
 * abuse case is bounded by whatever per-turn ceiling eventually lands. Flooring
 * the starting balance at zero in {@link dailyTopUpMicro} and in the cron's SQL
 * is the change that removes it.
 */
export const DAILY_CREDIT_TARGET_USD: Readonly<Record<Plan, number | null>> = {
  free: 0.25,
  pro: 0.5,
  unlimited: null,
}

/**
 * The daily target for a plan in credits, or null when the plan is not refilled
 * at all.
 *
 * A plan this table has never heard of falls back to `free`'s target rather than
 * to null: one added to the schema without a target here should under-grant a
 * single user, not silently stop refilling them. That is why membership is
 * tested with `in` — an explicit null and a missing key mean opposite things.
 */
export function dailyCreditTargetUsd(plan: string | null | undefined): number | null {
  if (plan != null && plan in DAILY_CREDIT_TARGET_USD) {
    const target = DAILY_CREDIT_TARGET_USD[plan as Plan]
    return typeof target === "number" && Number.isFinite(target) ? target : null
  }
  return DAILY_CREDIT_TARGET_USD.free
}

/**
 * What the daily cron would add to `balanceMicro` to reach the plan's target:
 * the shortfall, or zero when the balance is already at or above it — or when
 * the plan is not refilled.
 *
 * The cron applies this in SQL over every user at once rather than calling this
 * per row — this is here so the rule itself is testable, and so the route and
 * the tests cannot drift on what "top up to the target" means.
 */
export function dailyTopUpMicro(
  balanceMicro: bigint,
  plan: string | null | undefined
): bigint {
  const targetUsd = dailyCreditTargetUsd(plan)
  if (targetUsd === null) return 0n
  const target = usdToMicro(targetUsd)
  return balanceMicro < target ? target - balanceMicro : 0n
}

/**
 * The `externalId` a signup grant is keyed on.
 *
 * That column is uniquely indexed, so this string is what actually prevents a
 * second grant — not a prior read. The auth callback and the backfill script
 * both build it from here rather than each writing the literal, because a typo
 * in one of them would silently double-credit every user it touched.
 */
export function signupGrantKey(userId: string): string {
  return `signup:${userId}`
}

/** USD → micro-dollars, rounded to the nearest micro-dollar. */
export function usdToMicro(usd: number): bigint {
  if (!Number.isFinite(usd)) return 0n
  return BigInt(Math.round(usd * MICRO_PER_USD))
}

/**
 * Micro-dollars → USD, for display and for JSON responses.
 *
 * Balances are far below 2^53 micro-dollars ($9 billion), so the conversion
 * through `Number` is exact for any value this app will ever hold. It also has
 * to happen at every API boundary regardless: `JSON.stringify` throws on BigInt.
 */
export function microToUsd(micro: bigint): number {
  return Number(micro) / MICRO_PER_USD
}

/**
 * A Stripe amount (integer minor units — cents, for USD) → micro-dollars.
 *
 * Deliberately not routed through `usdToMicro`: Stripe already hands us an
 * exact integer, and dividing it by 100 to get dollars and multiplying back up
 * would put a float in the middle of the one number in this system that a user
 * actually paid. 1 cent is 10,000 micro-dollars, and BigInt keeps it exact.
 */
export function stripeAmountToMicro(amountInCents: number): bigint {
  if (!Number.isInteger(amountInCents)) return 0n
  return BigInt(amountInCents) * 10_000n
}

/** How a single turn's cost divides between the two balances. */
export interface TurnCostSplit {
  /** Paid out of the plan's daily allowance. */
  fromDaily: number
  /** Paid out of purchased credits. */
  fromCredits: number
}

/**
 * Split one turn's cost between the daily allowance and purchased credits.
 *
 * The allowance always goes first, because it expires at UTC midnight and
 * credits never do — spending a bought dollar while a free one is still on the
 * table is strictly worse for the user. `dailyLeft` is `Infinity` for the
 * `unlimited` plan, which then absorbs the whole cost and never reaches credits.
 *
 * Nothing is clamped to the balance the user actually holds, and that is the
 * point. A run is gated only *before* it starts, so the turn that empties the
 * balance can overshoot it by an unbounded amount — one production run cost
 * $476 of list value, which is still $23.80 of credits at today's Claude
 * multiplier. That overshoot is recorded as a negative balance, which the gate
 * refuses until a top-up (or enough daily credits) clears it. Clamping here
 * would quietly forgive it and make "top up a dollar, run an expensive turn,
 * repeat" a free ride.
 */
export function splitTurnCost({
  cost,
  dailyLeft,
}: {
  /** This turn's chargeable cost in credits, i.e. already discounted. */
  cost: number
  /** Daily allowance remaining *before* this turn, or Infinity when uncapped. */
  dailyLeft: number
}): TurnCostSplit {
  if (!(cost > 0) || !Number.isFinite(cost)) {
    return { fromDaily: 0, fromCredits: 0 }
  }
  const fromDaily = Math.min(cost, Math.max(0, dailyLeft))
  return { fromDaily, fromCredits: cost - fromDaily }
}

/**
 * The balance at or below which the UI starts warning, in credits.
 *
 * Sized against what a turn actually costs rather than as a fraction of any
 * balance: on the ledger's own per-turn averages (the same ones
 * {@link SIGNUP_CREDIT_USD} is measured in) a Claude turn is ~$0.125, an
 * OpenCode one ~$0.042 and a Gemini one ~$0.028. So $0.10 is the point where
 * the next Claude turn probably will not finish inside the balance — the first
 * moment a warning is something the user can act on rather than noise.
 *
 * The hard constraint is the one above it: this MUST stay below every entry in
 * {@link DAILY_CREDIT_TARGET_USD} ($0.25 free, $0.50 pro). A threshold at or
 * over the refill target would leave a freshly topped-up free user permanently
 * in the warning state, and a warning that is always on is a warning nobody
 * reads. Raise the daily targets and this is fine; raise this past $0.25 and
 * the whole free tier lives in amber.
 */
export const LOW_CREDIT_USD = 0.1

/**
 * How the UI describes a balance: healthy, worth warning about, or spent.
 *
 * `empty` is the UI's name for the send gate's own condition — `balance <= 0`,
 * matching `checkSharedPoolUsage` exactly (see lib/db/usage-limit), so the red
 * dot and the server's refusal can never disagree. `low` is advisory only and
 * has no counterpart on the server.
 */
export type CreditTier = "ok" | "low" | "empty"

/**
 * Classify a credit balance for display.
 *
 * `null` in, `null` out: a balance the caller could not determine, or one that
 * does not gate the user at all (the `unlimited` plan, or an account running
 * entirely on its own keys), must not be rendered as any tier — least of all
 * as `empty`, which a naive `<= 0` on a missing balance would produce.
 *
 * A non-finite balance is treated the same way, for the same reason: a NaN that
 * arrived through a JSON boundary should not tell a paying user they are out of
 * money.
 */
export function creditTier(balanceUsd: number | null | undefined): CreditTier | null {
  if (typeof balanceUsd !== "number" || !Number.isFinite(balanceUsd)) return null
  if (balanceUsd <= 0) return "empty"
  if (balanceUsd <= LOW_CREDIT_USD) return "low"
  return "ok"
}
