"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"
import type { StatsTimeRange } from "./useAdminStatsQuery"

export interface TopupUser {
  userId: string
  name: string
  image: string | null
  /** Sum of Stripe purchases credited to this user in range. */
  toppedUpUsd: number
  /** Sum of usage debits charged against this user's balance in range —
   * what actually left the balance (chargeableUsd), not list value. */
  spentUsd: number
  /** Number of purchases in range. */
  purchaseCount: number
}

/** A user's current credit balance — not range-scoped, unlike TopupUser. */
export interface UserBalance {
  userId: string
  balanceUsd: number
}

/** A point on the cumulative top-ups line: running total as of `time`. */
export interface TopupSeriesPoint {
  time: string
  cumulativeUsd: number
}

export interface AdminTopups {
  range: StatsTimeRange
  totalUsd: number
  totalCount: number
  users: TopupUser[]
  balances: UserBalance[]
  series: TopupSeriesPoint[]
}

async function fetchAdminTopups(
  range: StatsTimeRange,
  excludeAdmins: boolean
): Promise<AdminTopups> {
  return fetchAdminJson<AdminTopups>(
    `/api/admin/topups?range=${range}&excludeAdmins=${excludeAdmins}`,
    "topups"
  )
}

/**
 * Credit ledger rollups: a running total of top-up payments over time
 * (Overview), and every user's topped-up/spent totals in range, merged into
 * the Usage by user table (Leaderboard).
 */
export function useAdminTopupsQuery(range: StatsTimeRange = "30d", excludeAdmins = true) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.topups(range, excludeAdmins),
    queryFn: () => fetchAdminTopups(range, excludeAdmins),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: adminRetry,
  })
}
