/**
 * Tests for the mid-turn credit guard's stop decision.
 *
 * The metering half is already covered by ./meter-turn.test.ts; what is
 * asserted here is the arithmetic that decides whether a live agent gets
 * killed. Both directions matter and they are not symmetric: failing to stop
 * costs money, but stopping a solvent run destroys a user's work mid-sentence,
 * so the cases that must NOT trip are as important as the ones that must.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** Debit rows the guard will read back for the turn under test. */
let debits: { amountMicroUsd: bigint }[] = []
/** Balance getCreditBalance reports after metering. */
let balance = 0n
/** When set, the ledger read fails instead of returning `debits`. */
let ledgerError: Error | undefined

const meterAssistantTurn = vi.fn(async () => 1)

vi.mock("@/lib/server/token-metering", () => ({
  meterAssistantTurn: () => meterAssistantTurn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    message: { findFirst: vi.fn(async () => ({ id: "msg_1", metadata: null })) },
    creditTransaction: {
      findMany: vi.fn(async () => {
        if (ledgerError) throw ledgerError
        return debits
      }),
    },
  },
}))

vi.mock("@/lib/db/credits", () => ({
  getCreditBalance: vi.fn(async () => balance),
}))

import { creditBudgetExhausted } from "./credit-guard"

const daytona = { get: vi.fn(async () => ({})) } as never
const usd = (n: number) => BigInt(Math.round(n * 1_000_000))

/** A run that has been going ten minutes, on a user with a small balance. */
function run(overrides: Partial<Parameters<typeof creditBudgetExhausted>[0]> = {}) {
  return creditBudgetExhausted({
    userId: "user_1",
    chatId: "chat_1",
    agent: "claude-code",
    sandboxId: "sandbox_1",
    agentSessionId: "ses_abc",
    daytona,
    turnStartedAt: new Date(Date.now() - 10 * 60_000),
    plan: "pro",
    runningMinutes: 10,
    ...overrides,
  })
}

beforeEach(() => {
  debits = []
  balance = usd(5)
  ledgerError = undefined
  meterAssistantTurn.mockClear()
})

describe("creditBudgetExhausted", () => {
  it("stops a run whose balance has already gone negative", async () => {
    debits = [{ amountMicroUsd: usd(-1.4) }]
    balance = usd(-0.89)
    expect(await run()).toBe(true)
  })

  it("stops a run the next few minutes would take under", async () => {
    // $1.00 over 10 minutes = $0.10/min; three minutes ahead is $0.30, and only
    // $0.20 is left.
    debits = [{ amountMicroUsd: usd(-1) }]
    balance = usd(0.2)
    expect(await run()).toBe(true)
  })

  it("lets a run continue while the balance still covers the lookahead", async () => {
    // Same $0.10/min, but $2.00 left — far more than the $0.30 projected.
    debits = [{ amountMicroUsd: usd(-1) }]
    balance = usd(2)
    expect(await run()).toBe(false)
  })

  it("leaves a run alone when nothing has been charged to credits", async () => {
    // No debit rows is how an own-key, free-model or unsubsidised-provider run
    // presents: chargeTurnToCredits writes none for them. Such a run must not
    // be stopped even at a zero balance, because it is not spending it.
    debits = []
    balance = 0n
    expect(await run()).toBe(false)
  })

  it("does not sample a turn inside the blind window", async () => {
    // Below CREDIT_GUARD_MIN_RUN_MINUTES tokscale has nothing to report, so the
    // sandbox round-trip is pure cost — the meter must not even be called.
    expect(await run({ runningMinutes: 1 })).toBe(false)
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })

  it("does not sample an unlimited-plan run", async () => {
    balance = usd(-100)
    expect(await run({ plan: "unlimited" })).toBe(false)
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })

  it("lets the run continue when the ledger cannot be read", async () => {
    // A guard that cannot read the ledger knows nothing, and killing a healthy
    // agent on missing data is the worse of the two errors.
    ledgerError = new Error("connection pool exhausted")
    balance = usd(0.01)
    expect(await run()).toBe(false)
  })

  it("still decides on the ledger when metering itself failed", async () => {
    // meterTurnNow swallows its own failures, so a dead tokscale does not reach
    // the guard — it just means this tick banked nothing new. The balance and
    // debits already on record are still real, and a run that is nearly out on
    // those numbers should stop rather than get a reprieve for an unrelated
    // fault. Failing to meter under-counts spend, so this errs toward running on.
    meterAssistantTurn.mockRejectedValueOnce(new Error("tokscale exploded"))
    debits = [{ amountMicroUsd: usd(-1) }]
    balance = usd(0.01)
    expect(await run()).toBe(true)
  })
})
