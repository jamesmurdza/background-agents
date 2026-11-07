"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { NEW_REPOSITORY, type Agent } from "@/lib/types"
import { localHourToUtc } from "@/components/scheduled-jobs/form-config"
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
 * There's no React Query infrastructure for scheduled jobs yet (the jobs
 * list/detail views use plain fetch, not useQuery) — so there's no cache to
 * patch here. The suggested-name PATCH lands on the server; the jobs list
 * and detail page will pick it up on their next natural fetch/navigation.
 */
export function useCreateScheduledJobFromComposer(args: CreateScheduledJobFromComposerArgs) {
  const router = useRouter()
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
      })
      .catch((err) => {
        console.error("[useCreateScheduledJobFromComposer] name suggestion failed:", err)
      })

    onInputChange("")
    router.push(`/jobs/${created.id}`)
    return created
  }, [prompt, repo, baseBranch, agent, model, triggerType, effectiveIntervalMinutes,
    runAtHourLocal, runAtDay, autoPR, continueFromLastRun, incomingToken, isRepoLess,
    onInputChange, router])

  return { createJob }
}
