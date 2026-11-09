"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { ScheduledJobRun } from "@/lib/scheduled-jobs/types"

/**
 * Fetches the run history for a scheduled job (most recent first) — used by
 * the chat header's "Previous runs" dropdown so a job's runs can be browsed
 * without leaving the chat view. Only enabled when the dropdown is open
 * (via the `enabled` option) since this isn't needed until then.
 */
export function useScheduledJobRunsQuery(jobId: string | null, enabled: boolean) {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.scheduledJobs.runs(jobId ?? ""),
    queryFn: async (): Promise<ScheduledJobRun[]> => {
      const res = await fetch(`/api/scheduled-jobs/${jobId}/runs`)
      if (!res.ok) throw new Error("Failed to fetch job runs")
      const data = await res.json()
      return data.runs
    },
    enabled: isAuthenticated && !!jobId && enabled,
    staleTime: 15 * 1000,
  })
}
