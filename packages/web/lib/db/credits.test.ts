/**
 * Tests for the charging half of the credit ledger.
 *
 * The arithmetic these exercise lives in lib/server/credits and is unit-tested
 * there; what is tested here is that `chargeTurnToCredits` actually applies it —
 * which row it charges, at which multiplier, and what provenance it leaves
 * behind. That wiring is where a mistake is expensive: charging list value
 * overcharges users by up to 20×, and charging nothing at all is free uncapped
 * usage.
 *
 * `multipliers` is passed in directly rather than read from the database (see
 * lib/db/provider-pricing) — that is the whole reason chargeTurnToCredits takes
 * it as a parameter instead of looking it up itself: this file can test the
 * ledger-write wiring without mocking a pricing table.
 *
 * The transaction client is a stub. A real one would only be testing Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Prisma } from "@prisma/client"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { chargeTurnToCredits, readDebitProvenance, type ChargeableUsageRow } from "./credits"

/** The multipliers seeded into `ProviderPricing` — see that migration. */
const MULTIPLIERS: Record<string, number> = { claude: 0.05, opencode: 0.5, gemini: 0.5 }

/** Ledger rows written by the call under test. */
interface WrittenRow {
  userId: string
  amountMicroUsd: bigint
  type: string
  tokenUsageId: string | null
  description: string | null
  metadata?: Prisma.InputJsonValue
}

let written: WrittenRow[] = []

/**
 * Minimal stand-in for a Prisma transaction client: records what was inserted
 * and hands back a balance, which is all `applyCreditTransaction` reads.
 */
function makeTx() {
  return {
    user: {
      update: vi.fn(async () => ({ creditBalanceMicroUsd: 0n })),
    },
    creditTransaction: {
      create: vi.fn(async ({ data }: { data: WrittenRow }) => {
        written.push(data)
        return data
      }),
    },
  } as unknown as Prisma.TransactionClient
}

/** A chargeable shared-pool row, overridable per test. */
function usageRow(over: Partial<ChargeableUsageRow> = {}): ChargeableUsageRow {
  return {
    id: "tu_1",
    provider: "claude",
    pool: "shared",
    freeModel: false,
    costUsd: 2.4458,
    ...over,
  }
}

async function charge(rows: ChargeableUsageRow[], multipliers: Record<string, number> = MULTIPLIERS) {
  return chargeTurnToCredits(
    { userId: "u1", chatId: "c1", rows, dailyLeft: 0, multipliers },
    makeTx()
  )
}

beforeEach(() => {
  written = []
})

describe("chargeTurnToCredits", () => {
  it("charges Claude list value at its 0.05 multiplier", () => {
    // $2.4458 is the ledger's average Claude turn; a credit is not a dollar of
    // list value, and this is the whole reason why.
    return charge([usageRow()]).then((debited) => {
      expect(debited).toBe(122290n)
      expect(written).toHaveLength(1)
      expect(written[0].amountMicroUsd).toBe(-122290n)
      expect(written[0].type).toBe("debit")
      expect(written[0].tokenUsageId).toBe("tu_1")
    })
  })

  it("charges OpenCode and Gemini at half list value", async () => {
    await charge([
      usageRow({ id: "tu_oc", provider: "opencode", costUsd: 0.0887 }),
      usageRow({ id: "tu_gm", provider: "gemini", costUsd: 0.0563 }),
    ])
    expect(written.map((r) => r.amountMicroUsd)).toEqual([-44350n, -28150n])
  })

  it("records the list value and the multiplier in force", async () => {
    // Without this a debit cannot be tied back to the turn it paid for once the
    // admin moves the constants, which is the point of stamping it per row.
    await charge([usageRow()])
    const provenance = readDebitProvenance(written[0].metadata as Prisma.JsonValue)
    expect(provenance).toEqual({ listUsd: 2.4458, multiplier: 0.05, provider: "claude" })
    // The stamped multiplier is what makes the charge reversible.
    expect(provenance!.listUsd * provenance!.multiplier).toBeCloseTo(0.12229, 6)
  })

  it("leaves an unsubsidised provider at list value", async () => {
    // Only claude/opencode/gemini have shared pools, so nothing else should
    // reach here — but if it did, and it has no configured row, it must not be
    // silently discounted.
    const debited = await charge([
      usageRow({ provider: "kimi", pool: "shared", costUsd: 0.1089 }),
    ])
    expect(debited).toBe(0n)
    expect(written).toHaveLength(0)
  })

  it("charges nothing for own-key runs, free models or unpriced turns", async () => {
    const debited = await charge([
      usageRow({ id: "a", pool: "user" }),
      usageRow({ id: "b", freeModel: true }),
      usageRow({ id: "c", costUsd: 0 }),
    ])
    expect(debited).toBe(0n)
    expect(written).toHaveLength(0)
  })

  it("charges nothing for a provider whose multiplier is 0", async () => {
    // The admin panel's "free" state: a real, positive-cost row that still
    // draws nothing from the balance and leaves no debit behind.
    const debited = await charge(
      [usageRow({ provider: "opencode", costUsd: 4.2 })],
      { opencode: 0 }
    )
    expect(debited).toBe(0n)
    expect(written).toHaveLength(0)
  })

  it("skips a turn too cheap to register a micro-dollar", async () => {
    // The multiplier widens this window 20×. Writing a zero-amount row would
    // burn the usage row's one unique tokenUsageId slot for no movement.
    const debited = await charge([usageRow({ costUsd: 1e-6 })])
    expect(debited).toBe(0n)
    expect(written).toHaveLength(0)
  })

  it("still charges the cheapest genuine turn on the ledger", async () => {
    // $2.2e-4 of list value is the smallest real charge production has seen. It
    // must survive the multiplier rather than becoming a free turn.
    const debited = await charge([usageRow({ costUsd: 2.2e-4 })])
    expect(debited).toBeGreaterThan(0n)
  })

  it("charges each row of a multi-model turn separately", async () => {
    // A turn that switched models produces one usage row per model, and each
    // needs its own debit so it stays traceable to the row that caused it.
    await charge([
      usageRow({ id: "tu_a", costUsd: 2 }),
      usageRow({ id: "tu_b", costUsd: 4 }),
    ])
    expect(written.map((r) => r.tokenUsageId)).toEqual(["tu_a", "tu_b"])
    expect(written.map((r) => r.amountMicroUsd)).toEqual([-100000n, -200000n])
  })
})

describe("readDebitProvenance", () => {
  it("returns null for rows that carry none", () => {
    // Purchases, grants, daily top-ups, and any debit written before pricing
    // existed. Every caller has to handle the absence.
    expect(readDebitProvenance(null)).toBeNull()
    expect(readDebitProvenance({ day: "2026-09-05", cap: 1 })).toBeNull()
    expect(readDebitProvenance([1, 2])).toBeNull()
    expect(readDebitProvenance({ listUsd: "2.44", multiplier: 0.05 })).toBeNull()
  })

  it("translates a legacy divisor row into a multiplier", () => {
    // Rows written before the discount became an admin-editable multiplier
    // stamped `divisor` instead — history is never rewritten, so every reader
    // has to understand both shapes.
    expect(readDebitProvenance({ listUsd: 2.4458, divisor: 20, provider: "claude" })).toEqual({
      listUsd: 2.4458,
      multiplier: 0.05,
      provider: "claude",
    })
  })
})
