"use client"

import { useState, useEffect, useMemo } from "react"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentModels, type Agent, NEW_REPOSITORY } from "@/lib/types"
import {
  UNIT_MINUTES,
  inferIntervalMode,
  getTimezoneName,
  localHourToUtc,
  type IntervalUnit,
} from "@/components/scheduled-jobs/form-config"

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
  const isEditing = !!job

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

  // In create mode, the form may "materialize" the job into the DB the first
  // time the user clicks the MCP picker, so MCP server connections have a real
  // job id to hang off of. If the user then cancels, we DELETE the row so we
  // don't leave a half-configured job behind. On final submit this id is what
  // we PATCH (instead of POSTing again).
  // Materialized rows are created with enabled: false so the cron doesn't pick
  // them up before the user finishes; the final submit flips enabled back on.
  const [materializedJobId, setMaterializedJobId] = useState<string | null>(null)

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Incoming-webhook URL state. The token comes from the saved job and can be
  // swapped out via the rotate-token endpoint without closing the modal.
  const [incomingToken, setIncomingToken] = useState<string | null>(job?.incomingToken ?? null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [rotating, setRotating] = useState(false)

  // Get available models for selected agent
  const availableModels = agentModels[agent] ?? []

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
      setMaterializedJobId(null)
      setIncomingToken(job?.incomingToken ?? null)
      setCopiedUrl(false)
      setRotating(false)
    }
  }, [open, job])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[agent] ?? []
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model])

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

  /**
   * Build the request body for create/update from current form state.
   * Returns `null` and sets the visible error if required fields are missing.
   */
  function buildPayload(): Record<string, unknown> | null {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    if (!prompt.trim()) {
      setError("Prompt is required")
      return null
    }
    if (triggerType === "interval" && effectiveIntervalMinutes < 10) {
      setError("Interval must be at least 10 minutes")
      return null
    }
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

  /**
   * Materialize callback for the MCP picker — fired on the first MCP click
   * during create mode. POSTs the job (with enabled: false so the cron won't
   * pick it up mid-config) and returns the new id to the picker. Uses
   * placeholders for name/prompt if the user hasn't typed them yet; the
   * final-submit validation in handleSubmit enforces real values before the
   * row goes live. The form stays open and continues acting like create mode
   * until the user hits "Create" (PATCH to flip enabled on) or "Cancel"
   * (DELETE the row).
   *
   * Works for both interval and incoming triggers — the POST mints an
   * incomingToken regardless, so the URL panel can render immediately for
   * incoming-typed drafts. If the user flips the trigger pill after
   * materialize, the final-submit PATCH carries the new triggerType.
   */
  async function materializeJob(_draftId: string): Promise<string | null> {
    setError(null)
    try {
      const res = await fetch("/api/scheduled-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Placeholders only exist on disk while isDraft = true. They're never
          // shown in the UI list (the GET filters drafts out) and the cron
          // skips drafts. The final submit PATCH replaces them with real
          // values before flipping isDraft to false.
          name: name.trim() || "(draft)",
          prompt: prompt.trim() || "(draft)",
          // Drafts default to the repo-less sentinel so the row passes the
          // backend's repo check before the user fills the form in fully.
          repo: repo || NEW_REPOSITORY,
          baseBranch: baseBranch || "main",
          agent,
          model: model || null,
          triggerType,
          // Carry the client-minted token (if any) so the persisted URL matches
          // what the panel is already showing. Null on interval drafts — the
          // server mints a dormant one.
          incomingToken: incomingToken ?? undefined,
          // intervalMinutes is required by the POST for "interval" — pass a
          // safe placeholder for incoming drafts so the validator doesn't
          // reject. Final submit overrides whichever value matters.
          intervalMinutes:
            triggerType === "interval" ? effectiveIntervalMinutes : 10,
          autoPR,
          continueFromLastRun,
          enabled: false,
          isDraft: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to save job")
        return null
      }
      const created = await res.json()
      setMaterializedJobId(created.id)
      // Capture the token minted by POST so the URL panel can render the
      // moment the user flips to "Via webhook".
      if (created.incomingToken) {
        setIncomingToken(created.incomingToken)
      }
      return created.id
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
      return null
    }
  }

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload = buildPayload()
    if (!payload) return

    setLoading(true)

    try {
      const targetId = materializedJobId ?? job?.id
      const isUpdate = !!targetId
      const url = isUpdate
        ? `/api/scheduled-jobs/${targetId}`
        : "/api/scheduled-jobs"
      const method = isUpdate ? "PATCH" : "POST"

      // For materialized rows we created with enabled: false + isDraft: true;
      // promote both on final Create. For real edits, we leave existing state
      // alone.
      // Persist the client-minted token on every create path so the saved URL
      // matches what the panel shows — including after a pre-save rotate. Edits
      // leave the token alone (rotation there goes through the server endpoint).
      const body =
        materializedJobId && !isEditing
          ? { ...payload, enabled: true, isDraft: false, incomingToken: incomingToken ?? undefined }
          : isUpdate
            ? payload
            : { ...payload, incomingToken: incomingToken ?? undefined }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save job")
      }

      const savedJob = await res.json()
      // Clear the materialized marker so the close handler doesn't try to
      // delete what we just successfully saved.
      setMaterializedJobId(null)
      onSuccess(savedJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Close handler: if we materialized a job in create mode and the user is
   * walking away without saving, drop the row so we don't leak draft jobs.
   * Best-effort — even if cleanup fails we still close the modal.
   */
  const handleClose = async () => {
    if (materializedJobId && !isEditing) {
      const idToDelete = materializedJobId
      setMaterializedJobId(null)
      try {
        await fetch(`/api/scheduled-jobs/${idToDelete}`, { method: "DELETE" })
      } catch (err) {
        console.error("[ScheduledJobForm] cleanup delete failed:", err)
      }
    }
    onClose()
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
    try {
      await navigator.clipboard.writeText(incomingWebhookUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 1500)
    } catch (err) {
      console.error("[ScheduledJobForm] copy failed:", err)
    }
  }

  const handleRotateToken = async () => {
    // Create mode: the URL hasn't been handed out anywhere yet, so "rotate" is
    // just minting a fresh client-side UUID. No server round-trip, no confirm —
    // the new token is persisted on save (create POST / final PATCH carry it).
    if (!isEditing) {
      setIncomingToken(crypto.randomUUID())
      return
    }
    // Edit mode: the URL is live (the user may have wired it into an external
    // app), so rotate server-side to invalidate the old one immediately.
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

  return {
    // identity / mode
    isEditing,
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
    materializedJobId,
    showAgentDropdown,
    showModelDropdown,
    incomingToken,
    copiedUrl,
    rotating,
    // derived
    availableModels,
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
    materializeJob,
    handleSubmit,
    handleClose,
    handleCopyUrl,
    handleRotateToken,
    handleAgentChange,
    handleModelChange,
  }
}
