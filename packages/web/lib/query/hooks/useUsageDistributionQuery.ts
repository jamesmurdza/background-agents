"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"

/** Providers backed by a shared credential pool. */
export type UsageProvider = "claude" | "opencode" | "gemini"

/** The usage view is day-bucketed, so it excludes the unbounded "all" range. */
export type UsageRange = "24h" | "7d" | "30d"

/**
 * Which measure the usage charts show. Independent of a provider's *budget*
 * unit — OpenCode is budgeted in USD but you still want to see token volume.
 */
export type UsageMetric = "tokens" | "cost"

/** One time-series point for the shared-vs-own split. */
export interface PoolSplitPoint {
  time: string
  shared: number
  user: number
}

/** One model's usage within a user's row. */
export interface UserModelUsage {
  model: string
  pool: string
  tokens: number
  cost: number
}

/** A single user's usage for the selected provider and range. */
export interface UserUsage {
  userId: string
  name: string
  image: string | null
  tokens: number
  cost: number
  sharedTokens: number
  sharedCost: number
  ownTokens: number
  ownCost: number
  models: UserModelUsage[]
}

/** One bin of the per-message tokens/cost histogram. */
export interface MessageHistogramBucket {
  bucketStart: number
  bucketEnd: number
  count: number
}

export interface UsageDistribution {
  range: UsageRange
  provider: UsageProvider
  days: string[]
  /** Key fingerprints present in `byKey`, including "unattributed". */
  keyIds: string[]
  /** Shared vs own-key over time, one series per metric. */
  poolSplit: Record<UsageMetric, PoolSplitPoint[]>
  /** Per-pool-key over time (OpenCode only), one series per metric. */
  byKey: Record<UsageMetric, Array<Record<string, number | string>>>
  /** Per-user over time — one column per userId, gap-filled with 0s — for the
   * Leaderboard's stacked-area-by-user chart. */
  byUser: Record<UsageMetric, Array<Record<string, number | string>>>
  /** Per-user totals with a per-model breakdown, heaviest spender first. */
  users: UserUsage[]
  /** Distribution of per-message size, one histogram per metric. */
  messageHistogram: Record<UsageMetric, MessageHistogramBucket[]>
}

async function fetchUsageDistribution(
  range: UsageRange,
  provider: UsageProvider,
  excludeAdmins: boolean
): Promise<UsageDistribution> {
  return fetchAdminJson<UsageDistribution>(
    `/api/admin/usage-distribution?range=${range}&provider=${provider}&excludeAdmins=${excludeAdmins}`,
    "usage"
  )
}

export function useUsageDistributionQuery(
  range: UsageRange = "30d",
  provider: UsageProvider = "opencode",
  excludeAdmins = true
) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.usageDistribution(range, provider, excludeAdmins),
    queryFn: () => fetchUsageDistribution(range, provider, excludeAdmins),
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
    retry: adminRetry,
  })
}
