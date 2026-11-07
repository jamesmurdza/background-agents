"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

/**
 * Fetches the list of all scheduled jobs for the current user.
 * Only enabled when the user is authenticated.
 */
export function useScheduledJobsQuery() {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.scheduledJobs.list(),
    queryFn: async (): Promise<ScheduledJob[]> => {
      const res = await fetch("/api/scheduled-jobs")
      if (!res.ok) throw new Error("Failed to fetch scheduled jobs")
      const data = await res.json()
      return data.jobs
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
  })
}
