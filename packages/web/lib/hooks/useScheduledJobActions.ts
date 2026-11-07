"use client"

import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query/keys"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

/**
 * Shared scheduled-job actions (Run Now / Rotate Webhook Token / Delete / set
 * enabled) backing the job detail page's overflow menu, so the API-call logic
 * for each action lives in exactly one place and patches the shared React
 * Query cache.
 */
export function useScheduledJobActions() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const patchJobCaches = useCallback((job: ScheduledJob) => {
    queryClient.setQueryData<ScheduledJob>(queryKeys.scheduledJobs.detail(job.id), job)
    queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) =>
      old.map((j) => (j.id === job.id ? job : j))
    )
  }, [queryClient])

  const runNow = useCallback(async (job: ScheduledJob): Promise<void> => {
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}/run`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to trigger run")
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduledJobs.list() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduledJobs.runs(job.id) })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger run")
    }
  }, [queryClient])

  const rotateToken = useCallback(async (job: ScheduledJob): Promise<ScheduledJob | null> => {
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}/rotate-token`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to rotate webhook token")
      const updated: ScheduledJob = await res.json()
      patchJobCaches(updated)
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate webhook token")
      return null
    }
  }, [patchJobCaches])

  const setEnabled = useCallback(async (job: ScheduledJob, enabled: boolean): Promise<ScheduledJob | null> => {
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error("Failed to update job")
      const updated: ScheduledJob = await res.json()
      patchJobCaches(updated)
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update job")
      return null
    }
  }, [patchJobCaches])

  const rename = useCallback(async (job: ScheduledJob, name: string): Promise<ScheduledJob | null> => {
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("Failed to rename job")
      const updated: ScheduledJob = await res.json()
      patchJobCaches(updated)
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename job")
      return null
    }
  }, [patchJobCaches])

  const deleteJob = useCallback(async (job: ScheduledJob): Promise<boolean> => {
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete job")
      queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) =>
        old.filter((j) => j.id !== job.id)
      )
      queryClient.removeQueries({ queryKey: queryKeys.scheduledJobs.detail(job.id) })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
      return false
    }
  }, [queryClient])

  return { error, setError, runNow, rotateToken, setEnabled, rename, deleteJob }
}
