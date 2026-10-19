/**
 * Unit tests for when the composer's credit warning shows and when a dismissed
 * one comes back.
 */
import { describe, it, expect } from "vitest"

import {
  DISMISS_COOLDOWN_MS,
  dismissalIsStale,
  dismissalStorageKey,
  parseDismissal,
  warningTierToShow,
  type CreditWarningDismissal,
} from "./credit-warning"
import { LOW_CREDIT_USD } from "./server/credits"

const NOW = 1_700_000_000_000

/** A dismissal of the "low" banner at $0.08, one hour ago. */
const dismissedLow: CreditWarningDismissal = {
  tier: "low",
  dismissedAt: NOW - 60 * 60 * 1000,
  balanceAtDismiss: 0.08,
}

describe("warningTierToShow", () => {
  const base = { drawsSharedPool: true, dismissal: null, now: NOW }

  it("shows nothing on a healthy balance", () => {
    expect(warningTierToShow({ ...base, balanceUsd: 5 })).toBeNull()
  })

  it("warns below the threshold and blocks at zero", () => {
    expect(warningTierToShow({ ...base, balanceUsd: LOW_CREDIT_USD })).toBe("low")
    expect(warningTierToShow({ ...base, balanceUsd: 0 })).toBe("empty")
    expect(warningTierToShow({ ...base, balanceUsd: -1.5 })).toBe("empty")
  })

  it("stays silent for a user the balance doesn't gate", () => {
    // Own keys everywhere / logged out both arrive as null.
    expect(warningTierToShow({ ...base, balanceUsd: null })).toBeNull()
    expect(warningTierToShow({ ...base, balanceUsd: undefined })).toBeNull()
  })

  it("stays silent when the next send wouldn't draw the pool", () => {
    // A free model or the user's own key is not gated by credits, so warning
    // about the balance there would describe a block that doesn't exist —
    // even at a balance of zero.
    expect(
      warningTierToShow({ ...base, drawsSharedPool: false, balanceUsd: 0.02 })
    ).toBeNull()
    expect(warningTierToShow({ ...base, drawsSharedPool: false, balanceUsd: -3 })).toBeNull()
  })

  it("honours a live dismissal", () => {
    expect(
      warningTierToShow({ ...base, balanceUsd: 0.08, dismissal: dismissedLow })
    ).toBeNull()
  })

  it("re-shows once the dismissal goes stale", () => {
    // Escalation: dismissing "low" must not swallow "out of credits".
    expect(warningTierToShow({ ...base, balanceUsd: 0, dismissal: dismissedLow })).toBe(
      "empty"
    )
  })
})

describe("dismissalIsStale", () => {
  const base = { dismissal: dismissedLow, tier: "low" as const, balanceUsd: 0.08, now: NOW }

  it("holds while nothing has changed", () => {
    expect(dismissalIsStale(base)).toBe(false)
    // A small drift downward, inside the cooldown and above half, is not news.
    expect(dismissalIsStale({ ...base, balanceUsd: 0.07 })).toBe(false)
  })

  it("expires after the cooldown", () => {
    // Measured from the dismissal, not from `NOW` — the fixture was dismissed
    // an hour before it.
    const expiry = dismissedLow.dismissedAt + DISMISS_COOLDOWN_MS
    expect(dismissalIsStale({ ...base, now: expiry })).toBe(true)
    expect(dismissalIsStale({ ...base, now: expiry - 1 })).toBe(false)
  })

  it("re-arms when the tier escalates", () => {
    expect(dismissalIsStale({ ...base, tier: "empty", balanceUsd: 0 })).toBe(true)
  })

  it("re-arms after a top-up or the daily refill", () => {
    // The balance went up, so the next fall into a warning tier is new
    // information rather than the one they already dismissed.
    expect(dismissalIsStale({ ...base, balanceUsd: 0.09 })).toBe(true)
  })

  it("re-arms when the balance halves", () => {
    expect(dismissalIsStale({ ...base, balanceUsd: 0.04 })).toBe(true)
    expect(dismissalIsStale({ ...base, balanceUsd: 0.041 })).toBe(false)
  })

  it("does not let a halving rule fire on a zero-or-negative dismissal", () => {
    // Dismissed at exactly 0: half of 0 is 0, so an unguarded rule 4 would
    // call every subsequent render stale and the banner would never stay shut.
    const atZero: CreditWarningDismissal = { tier: "empty", dismissedAt: NOW, balanceAtDismiss: 0 }
    expect(
      dismissalIsStale({ dismissal: atZero, tier: "empty", balanceUsd: 0, now: NOW })
    ).toBe(false)
  })

  it("ignores a clock that moved backwards", () => {
    // A record written by a device ahead of this one must not silence the
    // banner forever, but it also must not count as elapsed.
    expect(dismissalIsStale({ ...base, now: NOW - 10 * DISMISS_COOLDOWN_MS })).toBe(false)
  })
})

describe("parseDismissal", () => {
  it("round-trips a real record", () => {
    expect(parseDismissal({ ...dismissedLow })).toEqual(dismissedLow)
  })

  it("rejects anything that isn't one, rather than throwing", () => {
    // A corrupt localStorage entry should cost one extra banner, not the
    // composer.
    expect(parseDismissal(null)).toBeNull()
    expect(parseDismissal("nope")).toBeNull()
    expect(parseDismissal({ tier: "ok", dismissedAt: NOW, balanceAtDismiss: 1 })).toBeNull()
    expect(parseDismissal({ tier: "low", dismissedAt: "soon", balanceAtDismiss: 1 })).toBeNull()
    expect(parseDismissal({ tier: "low", dismissedAt: NOW })).toBeNull()
    expect(parseDismissal({ tier: "low", dismissedAt: NaN, balanceAtDismiss: 1 })).toBeNull()
  })
})

describe("dismissalStorageKey", () => {
  it("scopes the record to one account", () => {
    // Two accounts on a shared browser must not inherit each other's silence.
    expect(dismissalStorageKey("u1")).not.toBe(dismissalStorageKey("u2"))
  })
})
