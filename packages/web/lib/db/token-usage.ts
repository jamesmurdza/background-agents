/**
 * TokenUsage ledger helpers.
 *
 * The ledger stores one row per (assistant turn × model) holding the DELTA of
 * tokens/cost for that turn. Deltas are derived by diffing tokscale's
 * cumulative-per-session totals against the previous capture for the same
 * (sessionId, model) — see `getSessionCumulatives` + `insertTokenUsageRows`,
 * driven by the runner in lib/server/token-metering.ts.
 *
 * `sumSharedUsage` is the read path the rate limiter uses: total tokens/cost a
 * user has consumed from a given shared pool since the start of the period.
 */

import { prisma } from "./prisma"

/** Credential pool a turn ran against. */
export type UsagePool = "shared" | "user"

/** A single delta row to persist for one (session, model) of one turn. */
export interface TokenUsageInsert {
  userId: string
  chatId?: string | null
  messageId?: string | null
  provider: string
  model?: string | null
  pool: UsagePool
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
}

/** Prior cumulative totals for one (session, model) pair, per component. */
export interface SessionCumulative {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
}

const ZERO_CUMULATIVE: SessionCumulative = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

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
  sessionId: string
): Promise<Map<string, SessionCumulative>> {
  const grouped = await prisma.tokenUsage.groupBy({
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

export { ZERO_CUMULATIVE }

/**
 * Persist a batch of per-turn delta rows. No-op for an empty array.
 */
export async function insertTokenUsageRows(
  rows: TokenUsageInsert[]
): Promise<void> {
  if (rows.length === 0) return
  await prisma.tokenUsage.createMany({
    data: rows.map((r) => ({
      userId: r.userId,
      chatId: r.chatId ?? null,
      messageId: r.messageId ?? null,
      provider: r.provider,
      model: r.model ?? null,
      pool: r.pool,
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
    })),
  })
}

export interface UsageTotals {
  totalTokens: number
  costUsd: number
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
    where: { userId, provider, pool, createdAt: { gte: since } },
    _sum: { totalTokens: true, costUsd: true },
  })
  return {
    totalTokens: agg._sum.totalTokens ?? 0,
    costUsd: agg._sum.costUsd ?? 0,
  }
}

/**
 * Per-provider usage breakdown for a user from one pool since `since`.
 * Used by the usage UI to show all three shared pools at once.
 */
export async function sumUsageByProvider(params: {
  userId: string
  since: Date
  pool?: UsagePool
}): Promise<Record<string, UsageTotals>> {
  const { userId, since, pool = "shared" } = params
  const grouped = await prisma.tokenUsage.groupBy({
    by: ["provider"],
    where: { userId, pool, createdAt: { gte: since } },
    _sum: { totalTokens: true, costUsd: true },
  })
  const out: Record<string, UsageTotals> = {}
  for (const g of grouped) {
    out[g.provider] = {
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: g._sum.costUsd ?? 0,
    }
  }
  return out
}
