"use client"

import { useState, useEffect, useMemo } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Clock, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentModels, agentLabels, getModelLabel, type Agent, NEW_REPOSITORY } from "@/lib/types"
import { AgentIcon } from "@/components/icons/agent-icons"

// =============================================================================
// Timezone Helpers
// =============================================================================

/** Get the user's timezone offset in hours (e.g., -8 for PST) */
function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset() / 60
}

/** Get short timezone name (e.g., "PST", "EST") */
function getTimezoneName(): string {
  return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(part => part.type === 'timeZoneName')?.value ?? 'Local'
}

/** Convert local hour (0-23) to UTC hour */
function localHourToUtc(localHour: number): number {
  const offset = getTimezoneOffset()
  let utcHour = localHour - offset
  if (utcHour < 0) utcHour += 24
  if (utcHour >= 24) utcHour -= 24
  return Math.floor(utcHour)
}

/** Convert UTC hour (0-23) to local hour */
function utcHourToLocal(utcHour: number): number {
  const offset = getTimezoneOffset()
  let localHour = utcHour + offset
  if (localHour < 0) localHour += 24
  if (localHour >= 24) localHour -= 24
  return Math.floor(localHour)
}

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobFormProps {
  open: boolean
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
  isMobile?: boolean
}

// =============================================================================
// Constants
// =============================================================================

const TRIGGER_TYPES = [
  {
    label: "On a schedule",
    value: "interval",
    description: "Run at regular intervals"
  },
  {
    label: "When CI/CD fails",
    value: "webhook",
    description: "Triggered by GitHub Actions failure"
  },
] as const

const INTERVAL_PRESETS = [
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "Hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "Day", value: 1440 },
  { label: "Week", value: 10080 },
]

const CUSTOM_INTERVAL = -1

type IntervalUnit = "minutes" | "hours" | "days" | "weeks"

const UNIT_MINUTES: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
}

const INTERVAL_UNITS: { label: string; value: IntervalUnit }[] = [
  { label: "minutes", value: "minutes" },
  { label: "hours", value: "hours" },
  { label: "days", value: "days" },
  { label: "weeks", value: "weeks" },
]

/** Express a stored intervalMinutes as either a preset or a (value, unit) pair. */
function inferIntervalMode(minutes: number): {
  isCustom: boolean
  intervalMinutes: number
  customValue: number
  customUnit: IntervalUnit
} {
  if (INTERVAL_PRESETS.some((p) => p.value === minutes)) {
    return { isCustom: false, intervalMinutes: minutes, customValue: 10, customUnit: "minutes" }
  }
  if (minutes % 10080 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 10080, customUnit: "weeks" }
  }
  if (minutes % 1440 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 1440, customUnit: "days" }
  }
  if (minutes % 60 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 60, customUnit: "hours" }
  }
  return { isCustom: true, intervalMinutes: minutes, customValue: minutes, customUnit: "minutes" }
}

const DAYS_OF_WEEK = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
]

const TIME_OPTIONS = [
  { label: "12:00 AM", value: 0 },
  { label: "1:00 AM", value: 1 },
  { label: "2:00 AM", value: 2 },
  { label: "3:00 AM", value: 3 },
  { label: "4:00 AM", value: 4 },
  { label: "5:00 AM", value: 5 },
  { label: "6:00 AM", value: 6 },
  { label: "7:00 AM", value: 7 },
  { label: "8:00 AM", value: 8 },
  { label: "9:00 AM", value: 9 },
  { label: "10:00 AM", value: 10 },
  { label: "11:00 AM", value: 11 },
  { label: "12:00 PM", value: 12 },
  { label: "1:00 PM", value: 13 },
  { label: "2:00 PM", value: 14 },
  { label: "3:00 PM", value: 15 },
  { label: "4:00 PM", value: 16 },
  { label: "5:00 PM", value: 17 },
  { label: "6:00 PM", value: 18 },
  { label: "7:00 PM", value: 19 },
  { label: "8:00 PM", value: 20 },
  { label: "9:00 PM", value: 21 },
  { label: "10:00 PM", value: 22 },
  { label: "11:00 PM", value: 23 },
]

const AVAILABLE_AGENTS: Agent[] = ["opencode", "claude-code", "codex"]

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobForm({ open, job, onClose, onSuccess, isMobile = false }: ScheduledJobFormProps) {
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
  const [triggerType, setTriggerType] = useState<"interval" | "webhook">(job?.triggerType ?? "interval")
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

  // Once we materialize, the trigger/schedule fields lock — the PATCH endpoint
  // doesn't accept triggerType / runAtHour / runAtDay, so allowing edits after
  // materialize would silently drop changes. Cancelling resets via DELETE.
  const isLocked = isEditing || !!materializedJobId

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Get available models for selected agent
  const availableModels = agentModels[agent] ?? []

  // Get timezone name for display
  const timezoneName = useMemo(() => getTimezoneName(), [])

  // What we actually send to the API (preset value, or custom value × unit).
  const effectiveIntervalMinutes = isCustomInterval
    ? Math.max(1, Math.floor(customIntervalValue || 0) * UNIT_MINUTES[customIntervalUnit])
    : intervalMinutes

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
    }
  }, [open, job])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[agent] ?? []
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model])

  // Webhook triggers require a real GitHub repo — snap back to interval if the
  // user clears the repo while webhook was selected.
  useEffect(() => {
    if (isRepoLess && triggerType === "webhook") {
      setTriggerType("interval")
    }
  }, [isRepoLess, triggerType])

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
    if (isRepoLess && triggerType === "webhook") {
      setError("Webhook triggers require a repository")
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
   * Only allowed for interval-triggered jobs — webhook jobs require a real
   * GitHub webhook setup at create time, which can't be deferred.
   */
  async function materializeJob(_draftId: string): Promise<string | null> {
    setError(null)
    if (triggerType === "webhook") {
      setError("Save the job first to attach MCP servers to webhook-triggered jobs.")
      return null
    }
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
          triggerType: "interval",
          intervalMinutes: effectiveIntervalMinutes,
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
      const body =
        materializedJobId && !isEditing
          ? { ...payload, enabled: true, isDraft: false }
          : payload

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

  const handleAgentChange = (newAgent: Agent) => {
    setAgent(newAgent)
    setShowAgentDropdown(false)
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setShowModelDropdown(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full border border-border rounded-lg shadow-xl max-h-[90vh]",
            !isMobile && "max-w-2xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <Clock className="h-4 w-4" />
                {isEditing ? "Edit Scheduled Agent" : "New Scheduled Agent"}
              </>
            }
          />

          {/* Form */}
          <form id="scheduled-job-form" onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Dependency Updates"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Trigger Type - Segmented Control */}
            <div>
              <label className="block text-sm font-medium mb-2">Trigger</label>
              <div className={cn(
                "inline-flex rounded-md bg-muted p-0.5",
                isLocked && "opacity-50"
              )}>
                {TRIGGER_TYPES.map((t) => {
                  // Webhook triggers attach to a GitHub repo, so they're not
                  // available in repo-less mode.
                  const isWebhookDisabled = t.value === "webhook" && isRepoLess
                  const disabled = isLocked || isWebhookDisabled
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => !disabled && setTriggerType(t.value)}
                      disabled={disabled}
                      title={isWebhookDisabled ? "Select a repository to use webhook triggers" : undefined}
                      className={cn(
                        "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                        triggerType === t.value
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                        isWebhookDisabled && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Schedule - only for scheduled trigger */}
            {triggerType === "interval" && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Run every</span>
                  <select
                    value={isCustomInterval ? CUSTOM_INTERVAL : intervalMinutes}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (val === CUSTOM_INTERVAL) {
                        // Seed custom inputs from the current preset so the
                        // effective interval doesn't change just by toggling
                        // into Custom mode.
                        const mode = inferIntervalMode(intervalMinutes)
                        setIsCustomInterval(true)
                        setCustomIntervalValue(mode.customValue)
                        setCustomIntervalUnit(mode.customUnit)
                      } else {
                        setIsCustomInterval(false)
                        setIntervalMinutes(val)
                      }
                    }}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {INTERVAL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value={CUSTOM_INTERVAL}>Custom…</option>
                  </select>

                  {isCustomInterval && (
                    <>
                      <input
                        type="number"
                        min={customIntervalUnit === "minutes" ? 10 : 1}
                        step={1}
                        value={customIntervalValue}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10)
                          setCustomIntervalValue(Number.isFinite(n) ? Math.max(1, n) : 1)
                        }}
                        className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <select
                        value={customIntervalUnit}
                        onChange={(e) => setCustomIntervalUnit(e.target.value as IntervalUnit)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {INTERVAL_UNITS.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {/* Day of week - only for exactly weekly */}
                  {effectiveIntervalMinutes === 10080 && (
                    <>
                      <span className="text-muted-foreground">on</span>
                      <select
                        value={runAtDay}
                        onChange={(e) => setRunAtDay(parseInt(e.target.value, 10))}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {DAYS_OF_WEEK.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {/* Time of day - for daily and weekly (preset or custom) */}
                  {effectiveIntervalMinutes >= 1440 && (
                    <>
                      <span className="text-muted-foreground">at</span>
                      <select
                        value={runAtHourLocal}
                        onChange={(e) => setRunAtHourLocal(parseInt(e.target.value, 10))}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {TIME_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">{timezoneName}</span>
                    </>
                  )}
                </div>

                {isCustomInterval && effectiveIntervalMinutes < 10 && (
                  <p className="text-xs text-destructive">
                    Interval must be at least 10 minutes.
                  </p>
                )}
              </div>
            )}

            {/* Prompt Field - styled like ChatInput */}
            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <div className={cn(
                "relative flex flex-col border shadow-sm bg-card border-border",
                isMobile ? "rounded-xl" : "rounded-2xl",
                "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
              )}>
                {/* Textarea */}
                <div className={cn(isMobile ? "px-3 py-2" : "px-4 py-3")}>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="What should the agent do?"
                    rows={4}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                  />
                </div>

                {/* Bottom bar with selectors. The container wrappers mirror
                    ChatInput so the inner pickers can reveal labels and counts
                    at the right widths via container queries. */}
                <div className={cn(
                  "@container flex items-center",
                  isMobile ? "gap-2 px-3 py-2" : "gap-3 px-4 py-2"
                )}>
                  {/* Left side items (repo / branch / MCP) */}
                  <div className={cn(
                    "flex items-center gap-2",
                    isMobile ? "w-full @container/row1" : "flex-1"
                  )}>
                    {/* Repo selector */}
                    <RepoCombobox
                      value={repo || null}
                      onChange={(newRepo, defaultBranch) => {
                        setRepo(newRepo)
                        setBaseBranch(defaultBranch)
                      }}
                      disabled={isEditing}
                      isMobile={isMobile}
                      showLabel
                    />

                    {/* Clear-repo X — only in create mode; edits keep the
                        repo immutable since the sandbox/branch pipeline is
                        already wired to it. */}
                    {repo && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setRepo("")
                          setBaseBranch("main")
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5"
                        title="Remove repository"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}

                    {/* Branch selector — only meaningful when a repo is set. */}
                    {repo && (
                      <BranchCombobox
                        repo={repo}
                        value={baseBranch}
                        onChange={setBaseBranch}
                        defaultBranch={baseBranch}
                        isMobile={isMobile}
                        showLabel
                      />
                    )}

                    {/* MCP servers picker — inline alongside repo/branch like
                        the chat input. In create mode the first click
                        materializes the job so the picker has a real id;
                        cancel cleans up. */}
                    <McpServersCombobox
                      entityId={materializedJobId ?? job?.id ?? "draft"}
                      apiBase="/api/scheduled-jobs"
                      isDraft={!isEditing && !materializedJobId}
                      onMaterializeDraft={materializeJob}
                      isMobile={isMobile}
                    />
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Agent selector */}
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowAgentDropdown(!showAgentDropdown)
                        setShowModelDropdown(false)
                      }}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title={agentLabels[agent]}
                    >
                      <AgentIcon agent={agent} className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{agentLabels[agent]}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showAgentDropdown && (
                      <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40">
                        {AVAILABLE_AGENTS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => handleAgentChange(a)}
                            className={cn(
                              "w-full text-left hover:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                              a === agent && "bg-accent"
                            )}
                          >
                            <AgentIcon agent={a} className="h-3.5 w-3.5" />
                            {agentLabels[a]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Model selector */}
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowModelDropdown(!showModelDropdown)
                        setShowAgentDropdown(false)
                      }}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title={getModelLabel(agent, model)}
                    >
                      <span className="hidden sm:inline">{getModelLabel(agent, model)}</span>
                      <span className="sm:hidden">Model</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showModelDropdown && (
                      <div className="absolute bottom-full right-0 mb-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52">
                        {availableModels.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => handleModelChange(m.value)}
                            className={cn(
                              "w-full text-left hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer",
                              m.value === model && "bg-accent"
                            )}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Options Section */}
            <div>
              <label className="block text-sm font-medium mb-2">Options</label>
              <div className="space-y-2">
                {/* Continue from last run — same checkbox in both modes, but
                    the backend interprets it differently: with a repo it
                    reuses the prior branch; repo-less it prepends the prior
                    run's final output as prompt context. */}
                {triggerType === "interval" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="continueFromLastRun"
                      checked={continueFromLastRun}
                      onChange={(e) => setContinueFromLastRun(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="continueFromLastRun" className="text-sm">
                      {isRepoLess
                        ? "Include the previous run's output as context"
                        : "Include commits from the previous run"}
                    </label>
                  </div>
                )}

                {/* Auto-PR has no target in repo-less mode (no remote to push to). */}
                {!isRepoLess && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoPR"
                      checked={autoPR}
                      onChange={(e) => setAutoPR(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="autoPR" className="text-sm">
                      Automatically create PR when there are new commits
                    </label>
                  </div>
                )}
              </div>
            </div>

          </form>

          {/* Actions - fixed at bottom */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="scheduled-job-form"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading ? "Saving..." : isEditing ? "Save Changes" : "Create"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
