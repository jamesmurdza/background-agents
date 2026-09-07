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
  totalUsd: number
  count: number
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
 * Top-up payments (Stripe purchases): a running total over time (Overview)
 * and the top payers in the range (Leaderboard).
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
