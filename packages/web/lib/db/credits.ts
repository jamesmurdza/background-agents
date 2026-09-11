/**
 * Credit balance reads and writes.
 *
 * `User.creditBalanceMicroUsd` is authoritative for reads — the send gate hits
 * it on every message, so it has to be O(1). `CreditTransaction` is the audit
 * trail beside it, and every movement writes both, in one transaction, or
 * neither.
 *
 * The arithmetic and the units live in lib/server/credits, which stays free of
 * database imports so it can be unit-tested.
 */

import { Prisma } from "@prisma/client"

import {
  chargeableUsd,
  microToUsd,
  normalizeMultiplier,
  SIGNUP_CREDIT_USD,
  signupGrantKey,
  splitTurnCost,
  usdToMicro,
} from "@/lib/server/credits"
import { BALANCE_POOL_PROVIDERS } from "@/lib/server/usage-budgets"

import { prisma } from "./prisma"

/** Why a balance moved. */
export type CreditTransactionType =
  | "purchase" // Stripe payment
  | "debit" // metered usage charged to the balance
  | "refund" // Stripe refund reversed the purchase
  | "grant" // signup credit, or a manual credit from an admin
  | "daily" // automatic daily top-up (app/api/cron/daily-credits)
  | "chargeback" // dispute opened against the payment
  | "adjustment" // manual correction

export interface ApplyCreditParams {
  userId: string
  /** Signed micro-dollars: positive credits the user, negative charges them. */
  amountMicroUsd: bigint
  type: CreditTransactionType
  /** Idempotency key (Stripe session / refund / dispute id). Unique. */
  externalId?: string | null
  /** The TokenUsage row a `debit` paid for. Unique. */
  tokenUsageId?: string | null
  stripeEventId?: string | null
  stripePaymentIntentId?: string | null
  chatId?: string | null
  description?: string | null
  metadata?: Prisma.InputJsonValue
}

async function applyInTransaction(
  params: ApplyCreditParams,
  tx: Prisma.TransactionClient
): Promise<bigint> {
  // Relative update, never read-then-write: two concurrent movements must both
  // land. The returned row carries the post-increment balance, so the ledger
  // row can record it without a second read.
  const user = await tx.user.update({
    where: { id: params.userId },
    data: { creditBalanceMicroUsd: { increment: params.amountMicroUsd } },
    select: { creditBalanceMicroUsd: true },
  })

  await tx.creditTransaction.create({
    data: {
      userId: params.userId,
      amountMicroUsd: params.amountMicroUsd,
      balanceAfterMicroUsd: user.creditBalanceMicroUsd,
      type: params.type,
      externalId: params.externalId ?? null,
      tokenUsageId: params.tokenUsageId ?? null,
      stripeEventId: params.stripeEventId ?? null,
      stripePaymentIntentId: params.stripePaymentIntentId ?? null,
      chatId: params.chatId ?? null,
      description: params.description ?? null,
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    },
  })

  return user.creditBalanceMicroUsd
}

/**
 * Move a user's balance and record why, atomically. Returns the new balance.
 *
 * Pass `tx` when the caller already holds a transaction (the metering path
 * does, and must — its debit has to commit with the usage rows it pays for or
 * not at all). Without one, this opens its own.
 *
 * A duplicate `externalId` or `tokenUsageId` throws a unique-constraint error
 * rather than being swallowed, which rolls the balance change back with it.
 * That is deliberate: callers know what a duplicate means for them, and
 * catching it here would leave an interactive transaction aborted but looking
 * successful. Postgres refuses every later statement in a transaction where a
 * constraint has fired, so "catch and carry on" is not available at this level.
 */
export async function applyCreditTransaction(
  params: ApplyCreditParams,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  if (params.amountMicroUsd === 0n) {
    return getCreditBalance(params.userId, tx)
  }
  if (tx) return applyInTransaction(params, tx)
  return prisma.$transaction((inner) => applyInTransaction(params, inner))
}

/**
 * Give a new account its starting balance. Returns true if this call granted.
 *
 * Idempotent through `externalId`, not through a prior read: the unique index
 * is what actually decides, so a retried signup callback and the backfill
 * script can both run against the same user, in any order or at the same time,
 * and exactly one grant survives. A duplicate is the expected outcome here
 * rather than an error, which is why this is the one caller that swallows the
 * constraint — see applyCreditTransaction on why it does not swallow it there.
 *
 * Never throws: a signup must not fail because crediting did. A user who slips
 * through with no grant is a support ticket; a user who cannot create an
 * account is a lost one.
 */
export async function grantSignupCredit(userId: string): Promise<boolean> {
  try {
    await applyCreditTransaction({
      userId,
      amountMicroUsd: usdToMicro(SIGNUP_CREDIT_USD),
      type: "grant",
      externalId: signupGrantKey(userId),
      description: "Signup credit",
    })
    return true
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false
    }
    console.error(`[credits] signup grant failed for user ${userId}:`, error)
    return false
  }
}

/** Current balance in micro-dollars. Zero for an unknown user. */
export async function getCreditBalance(
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  const db = tx ?? prisma
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { creditBalanceMicroUsd: true },
  })
  return user?.creditBalanceMicroUsd ?? 0n
}

/** The shape `chargeTurnToCredits` needs from a persisted usage row. */
export interface ChargeableUsageRow {
  id: string
  provider: string
  pool: string
  freeModel: boolean
  /** API list value, as stored. The multiplier is applied here, not upstream. */
  costUsd: number
}

/**
 * Charge a finished turn to the user's credit balance. Returns the total
 * debited, in micro-dollars.
 *
 * The amount debited is the row's list value times its provider's pricing
 * multiplier (see {@link chargeableUsd} in lib/server/credits) — a credit is
 * not a dollar of list value. Both numbers, and the multiplier between them,
 * are recorded on the ledger row. `multipliers` is pre-fetched by the caller
 * (see `getProviderMultipliers` in lib/db/provider-pricing) rather than looked
 * up here, so this stays a pure ledger-write path: one read of the pricing
 * table per turn instead of one per row, and unit-testable with a plain object
 * instead of a mocked database.
 *
 * Runs inside the metering transaction, under the advisory lock that already
 * serialises this session's usage writes — so the same turn cannot be charged
 * twice even if two finalizers race, and `tokenUsageId` being unique catches it
 * a second time if the lock ever fails to hold.
 *
 * `dailyLeft` is how much of a daily allowance to spend before credits. Every
 * caller passes 0 today — there is no daily tier — so the whole cost reaches
 * credits. The parameter and the split behind it are kept because they are the
 * only part of a daily allowance that is hard to get right, and re-deriving it
 * later is worse than carrying it: see splitTurnCost in lib/server/credits.
 *
 * Rows are charged in order, running `dailyLeft` down as they go. Most turns
 * produce exactly one row, but the loop costs nothing and keeps each debit
 * traceable to the usage row that caused it.
 *
 * Only shared-pool, non-free, budget-pool rows can draw the balance — the same
 * three conditions sumSharedSpend filters on, so what is charged and what is
 * counted as spent cannot drift apart. A provider whose multiplier is 0 clears
 * this loop too (chargeable computes to 0, so `fromCredits <= 0` skips it
 * below) — that is the entire mechanism behind a provider being free; there is
 * no separate "free provider" branch to keep in sync.
 */
export async function chargeTurnToCredits(
  params: {
    userId: string
    chatId?: string | null
    rows: ChargeableUsageRow[]
    /** Allowance remaining before this turn, or Infinity when uncapped. */
    dailyLeft: number
    /** Provider → pricing multiplier, from getProviderMultipliers. */
    multipliers: Record<string, number>
  },
  tx: Prisma.TransactionClient
): Promise<bigint> {
  const { userId, chatId, rows, multipliers } = params
  let dailyLeft = params.dailyLeft
  let debited = 0n

  for (const row of rows) {
    if (
      row.pool !== "shared" ||
      row.freeModel ||
      !BALANCE_POOL_PROVIDERS.includes(row.provider as never) ||
      !(row.costUsd > 0)
    ) {
      continue
    }

    // The ledger row holds list value; the balance is charged that times the
    // provider's multiplier. Applied here rather than at write time in
    // token-metering so `TokenUsage.costUsd` keeps meaning one thing — see the
    // header of lib/server/credits.
    const multiplier = normalizeMultiplier(multipliers[row.provider])
    const chargeable = chargeableUsd(row.costUsd, multiplier)

    const { fromDaily, fromCredits } = splitTurnCost({
      cost: chargeable,
      dailyLeft,
    })
    dailyLeft -= fromDaily
    if (fromCredits <= 0) continue

    const micro = usdToMicro(fromCredits)
    // A charge smaller than a micro-dollar rounds to nothing. Skipping it beats
    // writing a zero-amount ledger row that burns the row's one unique
    // tokenUsageId slot for no movement. A steep multiplier (e.g. 0.05) widens
    // this a little — it takes $0.00001 of list value to register — which is
    // still far below the cheapest genuine turn on the ledger.
    if (micro === 0n) continue

    await applyCreditTransaction(
      {
        userId,
        amountMicroUsd: -micro,
        type: "debit",
        tokenUsageId: row.id,
        chatId: chatId ?? null,
        // Just the provider: the Credits tab already renders the type ("Usage")
        // beside it, so anything more here reads as "Usage · claude usage".
        description: row.provider,
        // The provenance of the number above. `multiplier` is stamped per row
        // because it is the only thing that keeps this charge reproducible once
        // the admin moves it — without it an old debit cannot be tied back to
        // the list value it came from.
        metadata: {
          listUsd: row.costUsd,
          multiplier,
          provider: row.provider,
        },
      },
      tx
    )
    debited += micro
  }

  return debited
}

/** One row of a user's credit history, as the API returns it. */
export interface CreditTransactionRecord {
  id: string
  amountMicroUsd: bigint
  balanceAfterMicroUsd: bigint
  type: string
  description: string | null
  chatId: string | null
  /** Provenance: `{ listUsd, multiplier, provider }` on a debit, else null. */
  metadata: Prisma.JsonValue | null
  createdAt: Date
}

/** The provenance blob a `debit` row carries, once narrowed from JSON. */
export interface DebitProvenance {
  /** API list value of the turn, before the provider's multiplier. */
  listUsd: number
  /** The multiplier in force when this row was written. */
  multiplier: number
  provider: string
}

/**
 * Narrow a ledger row's `metadata` to {@link DebitProvenance}, or null.
 *
 * Rows written before pricing existed, and every non-debit row, have no
 * provenance — so every caller has to handle its absence anyway, and returning
 * null beats making them each re-derive the shape.
 *
 * Accepts the legacy `divisor` field too: rows written before the discount
 * became an admin-editable multiplier stamped `divisor` instead of
 * `multiplier`, and history is never rewritten — see the header of
 * lib/server/credits. Translating `1 / divisor` here means every caller sees
 * one shape regardless of when the row was written.
 */
export function readDebitProvenance(
  metadata: Prisma.JsonValue | null | undefined
): DebitProvenance | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const { listUsd, multiplier, divisor, provider } = metadata as Record<string, unknown>
  if (typeof listUsd !== "number" || !Number.isFinite(listUsd)) return null

  let m: number
  if (typeof multiplier === "number" && Number.isFinite(multiplier)) {
    m = multiplier
  } else if (typeof divisor === "number" && Number.isFinite(divisor) && divisor > 0) {
    m = 1 / divisor
  } else {
    return null
  }

  return { listUsd, multiplier: m, provider: typeof provider === "string" ? provider : "" }
}

/** What one provider actually cost the user, in credits, within one chat. */
export interface ChatProviderCredits {
  provider: string
  /** Credits debited for this provider in this chat, positive. */
  chargedUsd: number
}

/**
 * Credits actually debited for a chat, grouped by provider.
 *
 * The companion to `sumChatUsageByProvider` in lib/db/token-usage, which
 * answers the same question in list value. Both are worth showing: one is what
 * the conversation was worth, the other what it cost the user.
 *
 * Raw SQL because `CreditTransaction.tokenUsageId` is a plain column with no
 * Prisma relation behind it, so the join to the usage row's provider cannot be
 * expressed through the client. Grouping on the usage row rather than on the
 * debit's `description` keeps this correct even though the two happen to agree
 * today — a description is display text, not a key.
 */
export async function sumChatCreditsByProvider(
  chatId: string
): Promise<ChatProviderCredits[]> {
  const rows = await prisma.$queryRaw<Array<{ provider: string; micro: bigint }>>`
    SELECT tu."provider" AS provider,
           SUM(-t."amountMicroUsd")::bigint AS micro
      FROM "CreditTransaction" t
      JOIN "TokenUsage" tu ON tu."id" = t."tokenUsageId"
     WHERE t."chatId" = ${chatId}
       AND t."type" = 'debit'
     GROUP BY tu."provider"
  `
  return rows.map((r) => ({
    provider: r.provider,
    chargedUsd: microToUsd(r.micro),
  }))
}

/** A user's most recent balance movements, newest first. */
export async function listCreditTransactions(params: {
  userId: string
  limit?: number
}): Promise<CreditTransactionRecord[]> {
  const { userId, limit = 50 } = params
  return prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      amountMicroUsd: true,
      balanceAfterMicroUsd: true,
      type: true,
      description: true,
      chatId: true,
      metadata: true,
      createdAt: true,
    },
  })
}
