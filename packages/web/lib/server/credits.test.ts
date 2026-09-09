/**
 * Unit tests for credit units, the shared-pool discount, and the
 * daily-then-credits split.
 */
import { describe, it, expect } from "vitest"

import {
  chargeableUsd,
  creditTier,
  LOW_CREDIT_USD,
  DAILY_CREDIT_TARGET_USD,
  dailyCreditTargetUsd,
  dailyTopUpMicro,
  DEFAULT_MULTIPLIER,
  isFreeMultiplier,
  MICRO_PER_USD,
  microToUsd,
  normalizeMultiplier,
  splitTurnCost,
  stripeAmountToMicro,
  usdToMicro,
} from "./credits"

describe("stripeAmountToMicro", () => {
  it("converts Stripe's integer cents exactly", () => {
    expect(stripeAmountToMicro(1000)).toBe(10_000_000n) // $10.00
    expect(stripeAmountToMicro(1)).toBe(10_000n) // $0.01
  })

  it("keeps an amount a float round-trip would spoil", () => {
    // $10.07 via dollars is 10.07 * 1e6 = 10069999.999999998 before rounding.
    // Straight from cents there is no float in the path at all.
    expect(stripeAmountToMicro(1007)).toBe(10_070_000n)
    expect(stripeAmountToMicro(1007)).toBe(usdToMicro(10.07))
  })

  it("refuses a non-integer amount rather than rounding money", () => {
    // Stripe only ever sends integer minor units; anything else means we are
    // reading the wrong field, and guessing would mis-credit a real payment.
    expect(stripeAmountToMicro(10.5)).toBe(0n)
  })
})

describe("usdToMicro", () => {
  it("round-trips a dollar amount", () => {
    expect(usdToMicro(12.34)).toBe(12_340_000n)
    expect(microToUsd(12_340_000n)).toBeCloseTo(12.34, 10)
  })

  it("keeps sub-cent costs, which is the whole reason for the unit", () => {
    // A turn costing a fifth of a cent. Cents would round this to 0 (a free
    // route around the cap) or to 1 (a 5x overcharge).
    expect(usdToMicro(0.002)).toBe(2_000n)
  })

  it("absorbs the float residue the ledger produces", () => {
    // sumSharedSpend differences floats; a no-op lands here rather than on 0.
    expect(usdToMicro(4e-16)).toBe(0n)
  })

  it("is exact for a whole-dollar top-up", () => {
    expect(usdToMicro(100)).toBe(BigInt(100 * MICRO_PER_USD))
  })

  it("treats a non-finite cost as zero rather than throwing", () => {
    // BigInt(NaN) throws, which inside the metering transaction would lose the
    // whole turn's usage row, not just the debit.
    expect(usdToMicro(Number.NaN)).toBe(0n)
    expect(usdToMicro(Number.POSITIVE_INFINITY)).toBe(0n)
  })
})

describe("splitTurnCost", () => {
  it("takes the whole cost from the allowance when it fits", () => {
    expect(splitTurnCost({ cost: 2, dailyLeft: 5 })).toEqual({
      fromDaily: 2,
      fromCredits: 0,
    })
  })

  it("straddles the boundary, spending the allowance down to zero first", () => {
    const split = splitTurnCost({ cost: 8, dailyLeft: 5 })
    expect(split.fromDaily).toBeCloseTo(5, 10)
    expect(split.fromCredits).toBeCloseTo(3, 10)
  })

  it("charges everything to credits once the allowance is gone", () => {
    expect(splitTurnCost({ cost: 4, dailyLeft: 0 })).toEqual({
      fromDaily: 0,
      fromCredits: 4,
    })
  })

  it("never touches credits on an uncapped plan", () => {
    expect(splitTurnCost({ cost: 400, dailyLeft: Infinity })).toEqual({
      fromDaily: 400,
      fromCredits: 0,
    })
  })

  it("does not clamp an overshoot — the deficit is real and must be recorded", () => {
    // The gate lets a turn start on any positive balance, so a $476 run against
    // a spent allowance charges $476 to credits however little is left. Clamping
    // here would forgive it, and make a $1 top-up an unlimited turn.
    expect(splitTurnCost({ cost: 476, dailyLeft: 0 }).fromCredits).toBe(476)
  })

  it("ignores a negative allowance rather than crediting the user for it", () => {
    // Defensive: `used > allowance` after an overshoot could reach here as a
    // negative dailyLeft, which must not add itself to the credit charge.
    expect(splitTurnCost({ cost: 3, dailyLeft: -10 })).toEqual({
      fromDaily: 0,
      fromCredits: 3,
    })
  })

  it("splits nothing for a zero or unpriced turn", () => {
    expect(splitTurnCost({ cost: 0, dailyLeft: 5 })).toEqual({
      fromDaily: 0,
      fromCredits: 0,
    })
    expect(splitTurnCost({ cost: Number.NaN, dailyLeft: 5 })).toEqual({
      fromDaily: 0,
      fromCredits: 0,
    })
  })
})

describe("normalizeMultiplier", () => {
  it("passes through a valid multiplier, including 0", () => {
    expect(normalizeMultiplier(0.05)).toBe(0.05)
    expect(normalizeMultiplier(1)).toBe(1)
    expect(normalizeMultiplier(0)).toBe(0)
  })

  it("falls back to DEFAULT_MULTIPLIER for a missing or nonsense value", () => {
    // A corrupt or missing row must never make a turn free or pay the user to
    // run one by accident — free is only ever reached by an explicit 0.
    for (const value of [undefined, null, "0.05", -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeMultiplier(value)).toBe(DEFAULT_MULTIPLIER)
    }
  })
})

describe("isFreeMultiplier", () => {
  it("is true only for exactly 0", () => {
    expect(isFreeMultiplier(0)).toBe(true)
    expect(isFreeMultiplier(0.05)).toBe(false)
    expect(isFreeMultiplier(1)).toBe(false)
  })
})

describe("chargeableUsd", () => {
  it("multiplies list value by the provider's multiplier", () => {
    // The ledger's own per-turn averages, so these are the real figures, at
    // the multipliers seeded into ProviderPricing (0.05, 0.5, 0.5).
    expect(chargeableUsd(2.4458, 0.05)).toBeCloseTo(0.12229, 6)
    expect(chargeableUsd(0.0887, 0.5)).toBeCloseTo(0.04435, 6)
    expect(chargeableUsd(0.0563, 0.5)).toBeCloseTo(0.02815, 6)
  })

  it("leaves an unsubsidised provider at list value", () => {
    expect(chargeableUsd(0.1089, DEFAULT_MULTIPLIER)).toBe(0.1089)
  })

  it("charges nothing when the multiplier is exactly 0", () => {
    // The "free provider" case: a real cost times a 0 multiplier is 0, not a
    // no-op that still bills something.
    expect(chargeableUsd(2.4458, 0)).toBe(0)
  })

  it("round-trips back to list value through the multiplier", () => {
    // The inverse is what makes an old ledger row reproducible after the
    // admin moves the constants, so it has to actually hold.
    const listUsd = 2.4458
    const multiplier = 0.05
    const charged = chargeableUsd(listUsd, multiplier)
    expect(charged / multiplier).toBeCloseTo(listUsd, 10)
  })

  it("falls back to list value for an invalid multiplier rather than charging free", () => {
    expect(chargeableUsd(2.4458, -1)).toBe(2.4458)
    expect(chargeableUsd(2.4458, Number.NaN)).toBe(2.4458)
  })

  it("charges nothing for a zero, negative or unpriced turn", () => {
    expect(chargeableUsd(0, 0.05)).toBe(0)
    expect(chargeableUsd(-1, 0.05)).toBe(0)
    expect(chargeableUsd(Number.NaN, 0.05)).toBe(0)
  })

  it("stays above a micro-dollar for the cheapest genuine charge", () => {
    // $2.2e-4 is the cheapest real charge on the production ledger. Even at the
    // steepest multiplier it must survive usdToMicro rather than rounding to a
    // free turn.
    expect(usdToMicro(chargeableUsd(2.2e-4, 0.05))).toBeGreaterThan(0n)
  })
})

describe("dailyCreditTargetUsd", () => {
  it("gives free and pro their own targets", () => {
    expect(dailyCreditTargetUsd("free")).toBe(0.25)
    expect(dailyCreditTargetUsd("pro")).toBe(0.5)
  })

  it("returns null for unlimited, which is never refilled", () => {
    // Ungated: the send check short-circuits ahead of the balance and metering
    // skips the charge, so there is nothing to refill.
    expect(dailyCreditTargetUsd("unlimited")).toBeNull()
  })

  it("falls back to the free target for a plan it does not know", () => {
    // A missing key and an explicit null mean opposite things: a plan added to
    // the schema without a target must under-grant one user, not silently stop
    // being refilled.
    expect(dailyCreditTargetUsd("enterprise")).toBe(DAILY_CREDIT_TARGET_USD.free)
    expect(dailyCreditTargetUsd(null)).toBe(DAILY_CREDIT_TARGET_USD.free)
    expect(dailyCreditTargetUsd(undefined)).toBe(DAILY_CREDIT_TARGET_USD.free)
  })
})

describe("dailyTopUpMicro", () => {
  it("grants the shortfall, so the balance lands exactly on the plan target", () => {
    for (const plan of ["free", "pro"] as const) {
      const target = usdToMicro(DAILY_CREDIT_TARGET_USD[plan]!)
      for (const before of [0n, 100000n, target - 1n, -2000000n]) {
        expect(before + dailyTopUpMicro(before, plan)).toBe(target)
      }
    }
  })

  it("grants nothing at or above the target", () => {
    // A user who bought credits is not also handed change every night.
    expect(dailyTopUpMicro(usdToMicro(0.25), "free")).toBe(0n)
    expect(dailyTopUpMicro(usdToMicro(0.5), "pro")).toBe(0n)
    expect(dailyTopUpMicro(usdToMicro(40), "free")).toBe(0n)
  })

  it("grants nothing to unlimited, at any balance", () => {
    for (const before of [-2000000n, 0n, usdToMicro(100)]) {
      expect(dailyTopUpMicro(before, "unlimited")).toBe(0n)
    }
  })

  it("does not give a free user the pro target, or vice versa", () => {
    // $0.40 is above free's target and below pro's — the one balance that tells
    // the two rules apart.
    const balance = usdToMicro(0.4)
    expect(dailyTopUpMicro(balance, "free")).toBe(0n)
    expect(dailyTopUpMicro(balance, "pro")).toBe(usdToMicro(0.1))
  })

  it("clears a deficit in full rather than chipping at it", () => {
    // Deliberate, and the expensive half of the rule: an overshoot to -$20 is
    // back at the target tomorrow. See DAILY_CREDIT_TARGET_USD.
    expect(dailyTopUpMicro(usdToMicro(-20), "free")).toBe(usdToMicro(20.25))
  })

  it("is idempotent — a second application grants nothing", () => {
    // The cron sets a level rather than adding to one, so a double fire is a
    // no-op even if it got past the exactly-once guard.
    for (const plan of ["free", "pro"] as const) {
      const after = 0n + dailyTopUpMicro(0n, plan)
      expect(dailyTopUpMicro(after, plan)).toBe(0n)
    }
  })
})

describe("creditTier", () => {
  it("classifies the three states the UI paints", () => {
    expect(creditTier(1)).toBe("ok")
    expect(creditTier(LOW_CREDIT_USD + 0.001)).toBe("ok")
    expect(creditTier(LOW_CREDIT_USD)).toBe("low")
    expect(creditTier(0.01)).toBe("low")
    expect(creditTier(0)).toBe("empty")
    expect(creditTier(-4.2)).toBe("empty")
  })

  it("agrees with the send gate on exactly where zero falls", () => {
    // checkSharedPoolUsage allows on `credits > 0n` — so a balance of zero is
    // refused there and must read as `empty` here, not `low`. A disagreement
    // would paint a yellow dot on a send the server is about to 429.
    expect(creditTier(0)).toBe("empty")
    expect(creditTier(0.000001)).toBe("low")
  })

  it("reports no tier at all for a balance that doesn't gate the user", () => {
    // Unlimited plans and own-key accounts get null from the API, and a
    // logged-out visitor gets nothing. None may render as "empty".
    expect(creditTier(null)).toBeNull()
    expect(creditTier(undefined)).toBeNull()
    expect(creditTier(NaN)).toBeNull()
    expect(creditTier(Infinity)).toBeNull()
  })

  it("stays below every daily refill target", () => {
    // The invariant the threshold exists under: a user topped up to their
    // plan's target must open the app in the clear, or the warning is
    // permanent and therefore worthless.
    for (const target of Object.values(DAILY_CREDIT_TARGET_USD)) {
      if (target === null) continue
      expect(LOW_CREDIT_USD).toBeLessThan(target)
      expect(creditTier(target)).toBe("ok")
    }
  })
})
