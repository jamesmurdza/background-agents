"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { NEW_REPOSITORY, type Agent } from "@/lib/types"
import { localHourToUtc } from "@/components/scheduled-jobs/form-config"
import { useSidebar } from "@/lib/contexts"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { queryKeys } from "@/lib/query/keys"
import type { ScheduledJob } from "@/lib/scheduled-jobs/types"

interface CreateScheduledJobFromComposerArgs {
  prompt: string
  repo: string | null
  baseBranch: string
  agent: Agent
  model: string
  triggerType: "interval" | "incoming"
  effectiveIntervalMinutes: number
  runAtHourLocal: number
  runAtDay: number
  autoPR: boolean
  continueFromLastRun: boolean
  incomingToken: string | null
  isRepoLess: boolean
  /** Clears the composer text, same as a normal send. */
  onInputChange: (value: string) => void
}

/** Same truncation/fallback rule as suggest-title.ts's createFallbackName, so
 * the placeholder name created up-front looks the same as the LLM-suggested
 * fallback would. */
function placeholderNameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 5)
  let name = words.join(" ")
  if (name.length > 40) {
    name = name.slice(0, 37) + "..."
  }
  return name || "Scheduled job"
}

/**
 * Creates a scheduled job directly from the chat composer: POSTs the job
 * immediately (so navigation isn't blocked on an LLM title), then
 * fire-and-forget requests a better name and PATCHes it in once it resolves.
 *
 * Mirrors useSuggestNameMutation's cache-patch pattern on the chat side: once
 * the LLM name resolves, the detail and list caches for scheduled jobs are
 * updated directly rather than waiting on the next natural refetch.
 */
export function useCreateScheduledJobFromComposer(args: CreateScheduledJobFromComposerArgs) {
  const sidebar = useSidebar()
  const queryClient = useQueryClient()
  const {
    prompt, repo, baseBranch, agent, model, triggerType,
    effectiveIntervalMinutes, runAtHourLocal, runAtDay, autoPR,
    continueFromLastRun, incomingToken, isRepoLess, onInputChange,
  } = args

  const createJob = useCallback(async (): Promise<ScheduledJob | null> => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return null

    const runAtHourUtc = localHourToUtc(runAtHourLocal)
    const payload = {
      name: placeholderNameFromPrompt(trimmedPrompt),
      prompt: trimmedPrompt,
      repo: repo || NEW_REPOSITORY,
      baseBranch,
      agent,
      model: model || null,
      triggerType,
      intervalMinutes: triggerType === "interval" ? effectiveIntervalMinutes : undefined,
      runAtHour: triggerType === "interval" && effectiveIntervalMinutes >= 1440 ? runAtHourUtc : undefined,
      runAtDay: triggerType === "interval" && effectiveIntervalMinutes === 10080 ? runAtDay : undefined,
      autoPR: isRepoLess ? false : autoPR,
      continueFromLastRun,
      incomingToken: incomingToken ?? undefined,
    }

    const res = await fetch("/api/scheduled-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Failed to create scheduled job")
    }
    const created: ScheduledJob = await res.json()

    // Seed the shared caches so the detail page (navigated to below) and the
    // jobs list render immediately without waiting on a refetch.
    queryClient.setQueryData<ScheduledJob>(queryKeys.scheduledJobs.detail(created.id), created)
    queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) => [created, ...old])

    // Fire-and-forget: don't block the navigation/clear on an LLM title.
    // See useMessageDispatch's suggestNameMutation.mutate(...) call for the
    // analogous pattern on the chat side.
    void fetch("/api/scheduled-jobs/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: trimmedPrompt }),
    })
      .then(async (nameRes) => {
        if (!nameRes.ok) return
        const { name } = await nameRes.json()
        if (!name) return
        await fetch(`/api/scheduled-jobs/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })

        // Patch the detail and list caches, mirroring useSuggestNameMutation.
        queryClient.setQueryData<ScheduledJob>(queryKeys.scheduledJobs.detail(created.id), (old) =>
          old ? { ...old, name } : old
        )
        queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) =>
          old.map((j) => (j.id === created.id ? { ...j, name } : j))
        )
      })
      .catch((err) => {
        console.error("[useCreateScheduledJobFromComposer] name suggestion failed:", err)
      })

    onInputChange("")
    // Same in-SPA navigation pattern as useUrlSync's "job" route case —
    // set view state directly and pushState the URL, rather than
    // router.push, which renders /jobs/[id] as a separate Next route and
    // remounts the whole app shell.
    sidebar.setViewMode("scheduled-jobs")
    sidebar.setSelectedScheduledJob({ id: created.id, name: created.name })
    window.history.pushState(null, "", ROUTES.job.build(created.id))
    return created
  }, [prompt, repo, baseBranch, agent, model, triggerType, effectiveIntervalMinutes,
    runAtHourLocal, runAtDay, autoPR, continueFromLastRun, incomingToken, isRepoLess,
    onInputChange, sidebar, queryClient])

  return { createJob }
}
