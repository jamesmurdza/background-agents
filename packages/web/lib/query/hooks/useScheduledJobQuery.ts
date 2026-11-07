"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

/**
 * Fetches a single scheduled job's detail. Only enabled when the user is
 * authenticated and a jobId is provided.
 */
export function useScheduledJobQuery(jobId: string | null) {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.scheduledJobs.detail(jobId ?? ""),
    queryFn: async (): Promise<ScheduledJob> => {
      const res = await fetch(`/api/scheduled-jobs/${jobId}`)
      if (!res.ok) throw new Error("Failed to fetch scheduled job")
      return res.json()
    },
    enabled: isAuthenticated && !!jobId,
    staleTime: 30 * 1000,
  })
}
