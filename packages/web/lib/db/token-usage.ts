/**
 * TokenUsage ledger helpers.
 *
 * The ledger stores one row per (assistant turn × model) holding the DELTA of
 * tokens/cost for that turn. Deltas are derived by diffing tokscale's
 * cumulative-per-session totals against the previous capture for the same
 * (sessionId, model) — see `getSessionCumulatives` + `insertTokenUsageRows`,
 * driven by the runner in lib/server/token-metering.ts.
 *
 * `sumSharedSpend` is the read path the limiter uses: what a user has spent
 * across every shared pool since the start of the period. `sumSharedUsage`
 * answers the same question for one provider, for the usage views.
 */

import { Prisma } from "@prisma/client"

import { BALANCE_POOL_PROVIDERS } from "@/lib/server/usage-budgets"
import {
  ZERO_CUMULATIVE,
  type SessionCumulative,
} from "@/lib/server/usage-cursor"

import { prisma } from "./prisma"

/** Credential pool a turn ran against. */
export type UsagePool = "shared" | "user"

/**
 * A Prisma client or an interactive-transaction handle. The cursor read and
 * the row insert must be able to run on the *same* transaction, or the lock
 * that serialises them has nothing to protect.
 */
export type UsageDb = Prisma.TransactionClient | typeof prisma

/**
 * Namespace for this app's Postgres advisory locks, so a key derived from a
 * session id cannot collide with a lock taken for some unrelated purpose.
 * Arbitrary, but must stay stable: "toku" as ASCII.
 */
const ADVISORY_LOCK_NAMESPACE = 0x746f6b75

/**
 * Serialise metering for one agent session against every other writer.
 *
 * The ledger's delta is computed read-modify-write — read the prior rows, sum
 * them, insert the difference — with nothing making that atomic. Two writers
 * that read before either inserts compute the same delta and both persist it,
 * which is how one production reply came to be billed twice at $44.10.
 *
 * Takes a *transaction-scoped* advisory lock, which matters twice over: it is
 * released when the transaction ends however it ends (commit, rollback, or a
 * dropped connection), so a crashed finalizer cannot strand the session; and
 * it is the only advisory-lock form that is safe through a transaction-mode
 * pooler such as the Supabase/pgbouncer endpoint this app connects on, because
 * the transaction is pinned to one server connection for its whole life.
 *
 * The loser blocks here, then reads a cursor that already includes the
 * winner's rows, computes a zero delta, and writes nothing.
 */
export async function lockSessionForMetering(
  sessionId: string,
  tx: UsageDb
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int, hashtext(${sessionId})::int)`
}

/** A single delta row to persist for one (session, model) of one turn. */
export interface TokenUsageInsert {
  userId: string
  chatId?: string | null
  messageId?: string | null
  provider: string
  model?: string | null
  pool: UsagePool
  /**
   * Fingerprint (last 5 chars) of the shared-pool key that served the turn.
   * Set only for shared OpenCode runs; null everywhere else and on rows written
   * before per-key attribution existed.
   */
  keyId?: string | null
  /** Free model — recorded in totals but excluded from shared-pool budgets. */
  freeModel: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  coverage?: number | null
  sessionId: string
  /** Cumulative session+model totals at capture time (the next diff cursor). */
  cumulativeTotal: number
  cumulativeCost: number
  /**
   * Override the row timestamp. Used to backdate baseline rows (the first
   * capture of a session that predates metering) so they advance the diff
   * cursor but fall outside every daily/weekly budget window. Defaults to now.
   */
  createdAt?: Date
}

// The cursor shape and its keying rules live in lib/server/usage-cursor, which
// stays free of database imports so they can be unit-tested; re-exported here
// so callers of this module keep importing them from one place.
export { ZERO_CUMULATIVE, type SessionCumulative }

/**
 * Reconstruct the prior cumulative per model for a session by summing the
 * delta rows already recorded. Because every row holds a per-turn delta, the
 * sum of all prior deltas for a (session, model) equals tokscale's cumulative
 * at the last capture — so the next delta = (current tokscale cumulative) −
 * (this sum). Self-correcting: a dropped/duplicated row only skews one turn.
 *
 * Keyed by `model ?? ""`. Missing key ⇒ first capture for that model.
 */
export async function getSessionCumulatives(
  sessionId: string,
  tx: UsageDb = prisma
): Promise<Map<string, SessionCumulative>> {
  const grouped = await tx.tokenUsage.groupBy({
    by: ["model"],
    where: { sessionId },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      reasoningTokens: true,
      totalTokens: true,
      costUsd: true,
    },
  })

  const out = new Map<string, SessionCumulative>()
  for (const g of grouped) {
    out.set(g.model ?? "", {
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
      cacheReadTokens: g._sum.cacheReadTokens ?? 0,
      cacheWriteTokens: g._sum.cacheWriteTokens ?? 0,
      reasoningTokens: g._sum.reasoningTokens ?? 0,
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: g._sum.costUsd ?? 0,
    })
  }
  return out
}

/** A persisted delta row, as far as the credit debit needs to know it. */
export interface InsertedTokenUsageRow {
  id: string
  provider: string
  pool: string
  freeModel: boolean
  costUsd: number
}

/**
 * Persist a batch of per-turn delta rows, returning what was written. No-op for
 * an empty array.
 *
 * Returns the rows (via `createManyAndReturn`) rather than just a count because
 * the credit debit that follows in the same transaction keys on each row's id —
 * that unique `CreditTransaction.tokenUsageId` is what makes a usage charge
 * exactly-once and reconcilable row to row.
 */
export async function insertTokenUsageRows(
  rows: TokenUsageInsert[],
  tx: UsageDb = prisma
): Promise<InsertedTokenUsageRow[]> {
  if (rows.length === 0) return []
  return tx.tokenUsage.createManyAndReturn({
    select: {
      id: true,
      provider: true,
      pool: true,
      freeModel: true,
      costUsd: true,
    },
    data: rows.map((r) => ({
      userId: r.userId,
      chatId: r.chatId ?? null,
      messageId: r.messageId ?? null,
      provider: r.provider,
      model: r.model ?? null,
      pool: r.pool,
      keyId: r.keyId ?? null,
      freeModel: r.freeModel,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      reasoningTokens: r.reasoningTokens,
      totalTokens: r.totalTokens,
      costUsd: r.costUsd,
      coverage: r.coverage ?? null,
      sessionId: r.sessionId,
      cumulativeTotal: r.cumulativeTotal,
      cumulativeCost: r.cumulativeCost,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })),
  })
}

export interface UsageTotals {
  /** All components incl. cache (input+output+cache+reasoning). */
  totalTokens: number
  /**
   * Cache-excluded measure used for rate limiting: input (uncached) + output +
   * reasoning. Cache reads can be 100×+ the rest of a turn yet are nearly free,
   * so including them would make a token budget meaningless; we exclude them.
   */
  limitedTokens: number
  costUsd: number
}

function toTotals(sum: {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  costUsd: number | null
}): UsageTotals {
  return {
    totalTokens: sum.totalTokens ?? 0,
    limitedTokens:
      (sum.inputTokens ?? 0) + (sum.outputTokens ?? 0) + (sum.reasoningTokens ?? 0),
    costUsd: sum.costUsd ?? 0,
  }
}

/** Per-provider token total for a single chat. */
export interface ChatProviderUsage {
  provider: string
  totalTokens: number
  costUsd: number
}

/**
 * Total tokens/cost recorded for one chat, grouped by provider (all pools,
 * including cache and free models — this is a usage view, not a budget check).
 * Sorted by token count descending; providers with no usage are omitted.
 */
export async function sumChatUsageByProvider(
  chatId: string
): Promise<ChatProviderUsage[]> {
  const grouped = await prisma.tokenUsage.groupBy({
    by: ["provider"],
    where: { chatId },
    _sum: { totalTokens: true, costUsd: true },
  })
  return grouped
    .map((g) => ({
      provider: g.provider,
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: g._sum.costUsd ?? 0,
    }))
    .filter((p) => p.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

/**
 * Sum a user's usage from one pool for a given provider since `since`.
 * This is the limiter's aggregation query (indexed by
 * userId+provider+pool+createdAt).
 */
export async function sumSharedUsage(params: {
  userId: string
  provider: string
  since: Date
  pool?: UsagePool
}): Promise<UsageTotals> {
  const { userId, provider, since, pool = "shared" } = params
  const agg = await prisma.tokenUsage.aggregate({
    where: {
      userId,
      provider,
      pool,
      createdAt: { gte: since },
      // Free models are excluded from shared-pool budgets.
      ...(pool === "shared" ? { freeModel: false } : {}),
    },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      totalTokens: true,
      costUsd: true,
    },
  })
  return toTotals(agg._sum)
}

/**
 * What a user has spent since `since`, pooled across every shared provider.
 *
 * This is the limiter's aggregation query, and the single definition of "used"
 * — the limiter, the settings display and the usage view all read through it, so
 * they cannot disagree. Own-key runs are excluded because they were never
 * stamped `pool: "shared"`; free models are excluded by `freeModel`, which is
 * what keeps them usable on a spent allowance.
 */
export async function sumSharedSpend(
  params: {
    userId: string
    since: Date
  },
  // The metering path needs this on its own transaction: it has to read the
  // spend from *before* the turn it is about to insert, and a read outside the
  // transaction could see another writer's rows land in between.
  tx: UsageDb = prisma
): Promise<number> {
  const { userId, since } = params
  const agg = await tx.tokenUsage.aggregate({
    where: {
      userId,
      pool: "shared",
      freeModel: false,
      provider: { in: [...BALANCE_POOL_PROVIDERS] },
      createdAt: { gte: since },
    },
    _sum: { costUsd: true },
  })
  return agg._sum.costUsd ?? 0
}

