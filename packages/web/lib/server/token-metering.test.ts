/**
 * Tests for the metering transaction's use of the database connection.
 *
 * In production the Prisma pool holds ONE connection per instance (see
 * lib/db/prisma). An interactive transaction keeps that connection for its whole
 * life, so any query inside the callback that goes through the global client
 * instead of `tx` waits for the connection the transaction itself is holding.
 * It hangs until the transaction timeout kills it, and the turn goes unmetered.
 * That is how reading the pricing multipliers inside the transaction left turns
 * unbilled and later charged them as one lump.
 *
 * The mocked `$transaction` below models exactly that: while a callback runs,
 * the global client has no connection to give, so a read through it fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** True while a mocked `$transaction` callback is running. */
let inTransaction = false

/** Multipliers chargeTurnToCredits was given, to assert pricing still applies. */
let chargedWith: Record<string, number> | undefined

/** Whether a transaction was open at each multiplier read, in call order. */
let readInsideTransaction: boolean[] = []

const getProviderMultipliers = vi.fn(async () => {
  readInsideTransaction.push(inTransaction)
  if (inTransaction) {
    // What the one-connection pool does: wait for the connection the open
    // transaction holds. Failing fast stands in for the 10s hang.
    throw new Error("global client used while a transaction holds the only connection")
  }
  return { claude: 0.05 }
})

vi.mock("@/lib/db/provider-pricing", () => ({
  getProviderMultipliers: () => getProviderMultipliers(),
}))

const tx = {
  user: { findUnique: vi.fn(async () => ({ plan: "free" })) },
  chat: { findUnique: vi.fn(async () => ({ createdAt: new Date() })) },
  message: { count: vi.fn(async () => 1) },
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      inTransaction = true
      try {
        return await fn(tx)
      } finally {
        inTransaction = false
      }
    }),
  },
}))

vi.mock("@/lib/db/token-usage", () => ({
  lockSessionForMetering: vi.fn(async () => {}),
  getSessionCumulatives: vi.fn(async () => new Map()),
  insertTokenUsageRows: vi.fn(async (rows: Array<Record<string, unknown>>) =>
    rows.map((r, i) => ({ ...r, id: `tu_${i}` }))
  ),
}))

vi.mock("@/lib/db/credits", () => ({
  chargeTurnToCredits: vi.fn(
    async (params: { multipliers: Record<string, number> }) => {
      chargedWith = params.multipliers
      return 1000n
    }
  ),
}))

import { meterAssistantTurn } from "./token-metering"

/** A sandbox whose tokscale reports one Claude session with real usage. */
function sandboxReporting(sessionId: string) {
  const output = {
    entries: [
      {
        client: "claude",
        sessionId,
        model: "claude-sonnet-5",
        provider: "anthropic",
        input: 1_000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        cost: 0.02,
        messageCount: 1,
      },
    ],
  }
  return {
    process: {
      executeCommand: vi.fn(async () => ({ exitCode: 0, result: JSON.stringify(output) })),
    },
  } as unknown as Parameters<typeof meterAssistantTurn>[0]
}

describe("meterAssistantTurn", () => {
  beforeEach(() => {
    inTransaction = false
    chargedWith = undefined
    readInsideTransaction = []
    vi.clearAllMocks()
  })

  it("meters and charges a shared-pool turn with the provider multipliers", async () => {
    const written = await meterAssistantTurn(sandboxReporting("s1"), {
      userId: "u1",
      chatId: "c1",
      messageId: "m1",
      messageMetadata: { usage: { pool: "shared", provider: "claude", model: "claude-sonnet-5" } },
      agent: "claude-code",
      sessionId: "s1",
    })

    expect(written).toBe(1)
    expect(chargedWith).toEqual({ claude: 0.05 })
  })

  it("never reads through the global client while the transaction is open", async () => {
    await meterAssistantTurn(sandboxReporting("s1"), {
      userId: "u1",
      chatId: "c1",
      messageId: "m1",
      messageMetadata: { usage: { pool: "shared", provider: "claude", model: "claude-sonnet-5" } },
      agent: "claude-code",
      sessionId: "s1",
    })

    expect(readInsideTransaction).toEqual([false])
  })
})
