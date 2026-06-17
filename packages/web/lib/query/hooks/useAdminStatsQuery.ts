"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { StatsMetric } from "@/components/admin/charts/chartFormatters"

export type StatsTimeRange = "24h" | "7d" | "30d" | "all"
export type { StatsMetric }

interface AdminStats {
  range: StatsTimeRange
  metric: StatsMetric
  weeklyActiveUsers: Array<{
    date: string
    count: number
  }>
  // Top users by the selected metric. `primary` is the metric value;
  // `secondary` is the conversation count for the "messages" metric, else null.
  topUsers: Array<{
    name: string
    image?: string | null
    primary: number
    secondary: number | null
  }>
  // By-hour distribution, valued by the selected metric.
  hourly: Array<{
    hour: number
    value: number
  }>
  // Over-time series (hourly for 24h, bucketed otherwise). `value` is the
  // selected metric; `value2` is the conversation count for "messages", else null.
  series: Array<{
    time: string
    value: number
    value2: number | null
  }>
  byAgent: Array<Record<string, number | string>>
  byModel: Array<Record<string, number | string>>
}

async function fetchAdminStats(
  range: StatsTimeRange,
  excludeAdmins: boolean,
  metric: StatsMetric
): Promise<AdminStats> {
  const response = await fetch(
    `/api/admin/stats?range=${range}&excludeAdmins=${excludeAdmins}&metric=${metric}`
  )
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Forbidden: Admin access required")
    }
    throw new Error("Failed to fetch admin stats")
  }
  return response.json()
}

export function useAdminStatsQuery(
  range: StatsTimeRange = "7d",
  excludeAdmins = true,
  metric: StatsMetric = "tokens"
) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.stats(range, excludeAdmins, metric),
    queryFn: () => fetchAdminStats(range, excludeAdmins, metric),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: (failureCount, error) => {
      // Don't retry on 403 Forbidden
      if (error instanceof Error && error.message.includes("Forbidden")) {
        return false
      }
      return failureCount < 3
    },
  })
}
