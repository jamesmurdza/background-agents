"use client"

import { useState, useEffect, useMemo } from "react"
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentModels, getAgentModels, type Agent, NEW_REPOSITORY } from "@/lib/types"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import {
  UNIT_MINUTES,
  inferIntervalMode,
  getTimezoneName,
  localHourToUtc,
  type IntervalUnit,
} from "@/components/scheduled-jobs/form-config"
import {
  getFirstInvalidScheduledJobField,
  validateScheduledJobForm,
  type ScheduledJobFormErrors,
  type ScheduledJobFormField,
} from "@/lib/scheduled-jobs/form-validation"

interface UseScheduledJobFormArgs {
  open: boolean
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
}

/**
 * All state, effects and side-effecting handlers for the Scheduled Job form.
 * Kept in one place so the component file is pure layout — change the wiring
 * here, change the markup there.
 */
export function useScheduledJobForm({ open, job, onClose, onSuccess }: UseScheduledJobFormArgs) {
  // Form state
  const [name, setName] = useState(job?.name ?? "")
  const [prompt, setPrompt] = useState(job?.prompt ?? "")
  // Empty string means "no repo" in form state; on submit we send NEW_REPOSITORY.
  const [repo, setRepo] = useState(
    job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : ""
  )
  const [baseBranch, setBaseBranch] = useState(job?.baseBranch ?? "main")
  const isRepoLess = !repo
  const [agent, setAgent] = useState<Agent>((job?.agent as Agent) ?? "opencode")
  const [model, setModel] = useState(job?.model ?? "")
  const [triggerType, setTriggerType] = useState<"interval" | "incoming">(job?.triggerType ?? "interval")
  const initialIntervalMode = inferIntervalMode(job?.intervalMinutes ?? 1440)
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMode.intervalMinutes)
  const [isCustomInterval, setIsCustomInterval] = useState(initialIntervalMode.isCustom)
  const [customIntervalValue, setCustomIntervalValue] = useState(initialIntervalMode.customValue)
  const [customIntervalUnit, setCustomIntervalUnit] = useState<IntervalUnit>(initialIntervalMode.customUnit)
  const [runAtHourLocal, setRunAtHourLocal] = useState(9) // Local time, default to 9 AM
  const [runAtDay, setRunAtDay] = useState(1) // Default to Monday
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(job?.continueFromLastRun ?? false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ScheduledJobFormErrors>({})

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Incoming-webhook URL state. The token comes from the saved job and can be
  // swapped out via the rotate-token endpoint without closing the modal.
  const [incomingToken, setIncomingToken] = useState<string | null>(job?.incomingToken ?? null)
  const { copied: copiedUrl, copy: copyUrl } = useCopyToClipboard(1500)
  const [rotating, setRotating] = useState(false)

  // The user's custom endpoints, merged into the model list by name.
  const { data: settingsData } = useSettingsQuery()
  const customEndpoints = settingsData?.customEndpoints

  // Get available models for selected agent (built-ins + matching endpoints)
  const availableModels = getAgentModels(agent, customEndpoints)

  // Get timezone name for display
  const timezoneName = useMemo(() => getTimezoneName(), [])

  // What we actually send to the API (preset value, or custom value × unit).
  const effectiveIntervalMinutes = isCustomInterval
    ? Math.max(1, Math.floor(customIntervalValue || 0) * UNIT_MINUTES[customIntervalUnit])
    : intervalMinutes

  // Which Options-section toggles apply. The "continue" toggle is interval-only;
  // auto-PR needs a repo to push to. The section header renders only when at
  // least one applies — these same flags gate both the header and the toggles
  // so they can't drift apart.
  const showContinueOption = triggerType === "interval"
  const showAutoPROption = !isRepoLess
  const hasOptions = showContinueOption || showAutoPROption

  // Reset form state when job prop changes or modal opens
  useEffect(() => {
    if (open) {
      const initialAgent = (job?.agent as Agent) ?? "opencode"
      const initialModels = agentModels[initialAgent] ?? []
      setName(job?.name ?? "")
      setPrompt(job?.prompt ?? "")
      setRepo(job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : "")
      setBaseBranch(job?.baseBranch ?? "main")
      setAgent(initialAgent)
      setModel(job?.model ?? initialModels[0]?.value ?? "")
      setTriggerType(job?.triggerType ?? "interval")
      const mode = inferIntervalMode(job?.intervalMinutes ?? 1440)
      setIntervalMinutes(mode.intervalMinutes)
      setIsCustomInterval(mode.isCustom)
      setCustomIntervalValue(mode.customValue)
      setCustomIntervalUnit(mode.customUnit)
      setRunAtHourLocal(9)
      setRunAtDay(1)
      setAutoPR(job?.autoPR ?? true)
      setContinueFromLastRun(job?.continueFromLastRun ?? false)
      setError(null)
      setFieldErrors({})
      setIncomingToken(job?.incomingToken ?? null)
      setRotating(false)
    }
  }, [open, job])

  // Update model when agent changes (or endpoints load) — but keep a still-valid
  // selection, including a custom endpoint that belongs to the current agent.
  useEffect(() => {
    const models = getAgentModels(agent, customEndpoints)
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model, customEndpoints])

  useEffect(() => {
    if (triggerType === "incoming" && !incomingToken) {
      setIncomingToken(crypto.randomUUID())
    }
  }, [triggerType, incomingToken])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowAgentDropdown(false)
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  function buildPayload(): Record<string, unknown> {
    const runAtHourUtc = localHourToUtc(runAtHourLocal)
    return {
      name: name.trim(),
      prompt: prompt.trim(),
      // Empty form value means repo-less; send the NEW_REPOSITORY sentinel so
      // the backend can route through its existing no-clone sandbox path.
      repo: repo || NEW_REPOSITORY,
      baseBranch,
      agent,
      model: model || null,
      triggerType,
      intervalMinutes: triggerType === "interval" ? effectiveIntervalMinutes : undefined,
      runAtHour: triggerType === "interval" && effectiveIntervalMinutes >= 1440 ? runAtHourUtc : undefined,
      runAtDay: triggerType === "interval" && effectiveIntervalMinutes === 10080 ? runAtDay : undefined,
      // Auto-PR has nothing to push to in repo-less mode.
      autoPR: isRepoLess ? false : autoPR,
      continueFromLastRun,
    }
  }

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const validationErrors = validateScheduledJobForm({
      name,
      prompt,
      triggerType,
      intervalMinutes: effectiveIntervalMinutes,
    })
    setFieldErrors(validationErrors)

    const firstInvalidField = getFirstInvalidScheduledJobField(validationErrors)
    if (firstInvalidField) {
      const form = e.currentTarget
      requestAnimationFrame(() => {
        const field = form.elements.namedItem(firstInvalidField)
        if (field instanceof HTMLElement) field.focus()
      })
      return
    }

    const payload = buildPayload()

    setLoading(true)

    try {
      const res = await fetch(`/api/scheduled-jobs/${job?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save job")
      }

      const savedJob = await res.json()
      onSuccess(savedJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Build the URL the user pastes into their external app. Browser-only —
   * SSR returns an empty string and the panel hides the value until hydration.
   */
  const incomingWebhookUrl = useMemo(() => {
    if (!incomingToken) return ""
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/wh/${incomingToken}`
  }, [incomingToken])

  const handleCopyUrl = async () => {
    if (!incomingWebhookUrl) return
    await copyUrl(incomingWebhookUrl)
  }

  const handleRotateToken = async () => {
    // The URL is live (the user may have wired it into an external app), so
    // rotate server-side to invalidate the old one immediately.
    const targetId = job?.id
    if (!targetId) return
    if (!confirm("Rotating will invalidate the existing webhook URL. Continue?")) return
    setRotating(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduled-jobs/${targetId}/rotate-token`, {
        method: "POST",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to rotate token")
      }
      const updated = await res.json()
      setIncomingToken(updated.incomingToken ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate token")
    } finally {
      setRotating(false)
    }
  }

  const handleAgentChange = (newAgent: Agent) => {
    setAgent(newAgent)
    setShowAgentDropdown(false)
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setShowModelDropdown(false)
  }

  const clearFieldError = (field: ScheduledJobFormField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return {
    // identity
    jobId: job?.id,
    // values
    name,
    prompt,
    repo,
    baseBranch,
    isRepoLess,
    agent,
    model,
    triggerType,
    intervalMinutes,
    isCustomInterval,
    customIntervalValue,
    customIntervalUnit,
    runAtHourLocal,
    runAtDay,
    autoPR,
    continueFromLastRun,
    loading,
    error,
    fieldErrors,
    showAgentDropdown,
    showModelDropdown,
    incomingToken,
    copiedUrl,
    rotating,
    // derived
    availableModels,
    customEndpoints,
    timezoneName,
    effectiveIntervalMinutes,
    showContinueOption,
    showAutoPROption,
    hasOptions,
    incomingWebhookUrl,
    // setters
    setName,
    setPrompt,
    setRepo,
    setBaseBranch,
    setModel,
    setTriggerType,
    setIntervalMinutes,
    setIsCustomInterval,
    setCustomIntervalValue,
    setCustomIntervalUnit,
    setRunAtHourLocal,
    setRunAtDay,
    setAutoPR,
    setContinueFromLastRun,
    setShowAgentDropdown,
    setShowModelDropdown,
    // handlers
    handleSubmit,
    handleClose: onClose,
    handleCopyUrl,
    handleRotateToken,
    handleAgentChange,
    handleModelChange,
    clearFieldError,
  }
}
