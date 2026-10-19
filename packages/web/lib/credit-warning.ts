/**
 * When the composer's low-credit warning is shown, and when a dismissed one
 * comes back.
 *
 * The dot in the agent picker is ambient state — it is always accurate and has
 * no dismissal. This module governs the *interruptive* half: the banner above
 * the composer. A banner that reappears on every page load is noise a user
 * learns to click past, and one that never reappears is a warning they see once
 * and forget, so the rules below try to fire exactly when there is something new
 * to say.
 *
 * Deliberately free of React and of `localStorage` itself: the decision is a
 * pure function of (tier, balance, stored record, now), which is what makes the
 * cooldown testable without faking a clock inside a component.
 */

import { creditTier, type CreditTier } from "@/lib/server/credits"

/** What a dismissal remembers. Stored per user, per device. */
export interface CreditWarningDismissal {
  /** The tier that was on screen when the user dismissed it. */
  tier: Exclude<CreditTier, "ok">
  /** Epoch ms of the dismissal. */
  dismissedAt: number
  /** The balance in USD at that moment — rule 3 and 4 below compare against it. */
  balanceAtDismiss: number
}

/**
 * How long a dismissal silences the same tier.
 *
 * Matched to the daily-credit cron rather than picked round: credits refill once
 * a day (see DAILY_CREDIT_TARGET_USD), so a shorter window would nag a user
 * repeatedly about a balance that cannot change in their favour until tomorrow,
 * and a longer one would let a whole refill cycle pass unmentioned.
 */
export const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Whether a dismissal has stopped applying to the situation the user is now in.
 *
 * Any one of these is enough:
 *
 *  1. **The tier got worse.** A dismissed "running low" must never swallow "out
 *     of credits" — it is a different message, and the second one explains why
 *     sends have started failing.
 *  2. **The cooldown elapsed.** See {@link DISMISS_COOLDOWN_MS}.
 *  3. **The balance went up.** A top-up or the daily refill means the next fall
 *     into a warning tier is genuinely new; a user who tops up and burns through
 *     it in an hour should hear about it.
 *  4. **The balance halved.** $0.09 → $0.04 is materially worse than what they
 *     dismissed, even inside the cooldown.
 *
 * The inverse — none of the four — is the only case where the banner stays
 * hidden.
 */
export function dismissalIsStale({
  dismissal,
  tier,
  balanceUsd,
  now,
}: {
  dismissal: CreditWarningDismissal
  tier: Exclude<CreditTier, "ok">
  balanceUsd: number
  now: number
}): boolean {
  // 1. Escalation. Only low → empty is a real escalation; empty → low means the
  // balance recovered, which rule 3 already covers.
  if (dismissal.tier !== tier) return true

  // 2. Cooldown. `now - dismissedAt` is negative if the clock moved backwards or
  // the record was written by a device ahead of this one, which reads as "not
  // elapsed" — the other rules still apply, so a bad clock cannot silence the
  // banner forever.
  if (now - dismissal.dismissedAt >= DISMISS_COOLDOWN_MS) return true

  // 3. Refilled or topped up since the dismissal.
  if (balanceUsd > dismissal.balanceAtDismiss) return true

  // 4. Materially worse. Guarded on a positive balance at dismissal: at or below
  // zero, halving says nothing (0 → -5 is worse but 0/2 is still 0), and rule 1
  // has already handled the tier change into `empty`.
  if (dismissal.balanceAtDismiss > 0 && balanceUsd <= dismissal.balanceAtDismiss / 2) {
    return true
  }

  return false
}

/**
 * The tier to show in the composer banner, or null to show nothing.
 *
 * Null covers all of: a healthy balance, a user the balance doesn't gate
 * (`balanceUsd` null — own keys everywhere, logged out), a
 * send that wouldn't draw the shared pool anyway, and a live dismissal.
 *
 * `drawsSharedPool` is what keeps the banner honest about the *current*
 * selection. Credits gate a run only when it resolves to a shared pool, so
 * warning a user who is about to send on their own key, or on a free model,
 * would be telling them their balance blocks something it does not.
 */
export function warningTierToShow({
  balanceUsd,
  drawsSharedPool,
  dismissal,
  now,
}: {
  balanceUsd: number | null | undefined
  drawsSharedPool: boolean
  dismissal: CreditWarningDismissal | null
  now: number
}): Exclude<CreditTier, "ok"> | null {
  if (!drawsSharedPool) return null

  const tier = creditTier(balanceUsd)
  if (tier === null || tier === "ok") return null

  // Narrowed by creditTier returning non-null.
  const balance = balanceUsd as number

  if (dismissal && !dismissalIsStale({ dismissal, tier, balanceUsd: balance, now })) {
    return null
  }
  return tier
}

/**
 * Parse a stored dismissal, rejecting anything that isn't one.
 *
 * A malformed record reads as "never dismissed" rather than throwing: the
 * failure mode of showing the banner once more is strictly better than a
 * corrupt localStorage entry breaking the composer.
 */
export function parseDismissal(raw: unknown): CreditWarningDismissal | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Partial<CreditWarningDismissal>
  if (r.tier !== "low" && r.tier !== "empty") return null
  if (typeof r.dismissedAt !== "number" || !Number.isFinite(r.dismissedAt)) return null
  if (typeof r.balanceAtDismiss !== "number" || !Number.isFinite(r.balanceAtDismiss)) {
    return null
  }
  return { tier: r.tier, dismissedAt: r.dismissedAt, balanceAtDismiss: r.balanceAtDismiss }
}

/**
 * The localStorage key for a user's dismissal.
 *
 * Keyed by user id so two accounts on one browser don't inherit each other's
 * dismissals — the balance is per-account, and a shared machine is exactly where
 * a stale suppression would be most confusing.
 */
export function dismissalStorageKey(userId: string): string {
  return `credit-warning-dismissed:${userId}`
}
