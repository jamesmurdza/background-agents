"use client"

import { useState, useEffect, useMemo } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Clock, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentModels, agentLabels, getModelLabel, type Agent } from "@/lib/types"
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
  { label: "Hour", value: 60 },
  { label: "Day", value: 1440 },
  { label: "Week", value: 10080 },
]

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
  const [repo, setRepo] = useState(job?.repo ?? "")
  const [baseBranch, setBaseBranch] = useState(job?.baseBranch ?? "main")
  const [agent, setAgent] = useState<Agent>((job?.agent as Agent) ?? "opencode")
  const [model, setModel] = useState(job?.model ?? "")
  const [triggerType, setTriggerType] = useState<"interval" | "webhook">(job?.triggerType ?? "interval")
  const [intervalMinutes, setIntervalMinutes] = useState(job?.intervalMinutes ?? 1440)
  const [runAtHourLocal, setRunAtHourLocal] = useState(9) // Local time, default to 9 AM
  const [runAtDay, setRunAtDay] = useState(1) // Default to Monday
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(job?.continueFromLastRun ?? false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Get available models for selected agent
  const availableModels = agentModels[agent] ?? []

  // Get timezone name for display
  const timezoneName = useMemo(() => getTimezoneName(), [])

  // Reset form state when job prop changes or modal opens
  useEffect(() => {
    if (open) {
      const initialAgent = (job?.agent as Agent) ?? "opencode"
      const initialModels = agentModels[initialAgent] ?? []
      setName(job?.name ?? "")
      setPrompt(job?.prompt ?? "")
      setRepo(job?.repo ?? "")
      setBaseBranch(job?.baseBranch ?? "main")
      setAgent(initialAgent)
      setModel(job?.model ?? initialModels[0]?.value ?? "")
      setTriggerType(job?.triggerType ?? "interval")
      setIntervalMinutes(job?.intervalMinutes ?? 1440)
      setRunAtHourLocal(9)
      setRunAtDay(1)
      setAutoPR(job?.autoPR ?? true)
      setContinueFromLastRun(job?.continueFromLastRun ?? false)
      setError(null)
    }
  }, [open, job])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[agent] ?? []
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model])

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

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate
    if (!name.trim()) {
      setError("Name is required")
      return
    }
    if (!prompt.trim()) {
      setError("Prompt is required")
      return
    }
    if (!repo) {
      setError("Repository is required")
      return
    }

    setLoading(true)

    // Convert local hour to UTC for storage
    const runAtHourUtc = localHourToUtc(runAtHourLocal)

    try {
      const url = isEditing ? `/api/scheduled-jobs/${job.id}` : "/api/scheduled-jobs"
      const method = isEditing ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          repo,
          baseBranch,
          agent,
          model: model || null,
          triggerType,
          intervalMinutes: triggerType === "interval" ? intervalMinutes : undefined,
          runAtHour: triggerType === "interval" && intervalMinutes >= 1440 ? runAtHourUtc : undefined,
          runAtDay: triggerType === "interval" && intervalMinutes === 10080 ? runAtDay : undefined,
          autoPR,
          continueFromLastRun,
        }),
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

  const handleAgentChange = (newAgent: Agent) => {
    setAgent(newAgent)
    setShowAgentDropdown(false)
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setShowModelDropdown(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
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

            {/* Prompt Field - styled like ChatInput */}
            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <div className="rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                {/* Textarea */}
                <div className="px-3 py-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="What should the agent do?"
                    rows={4}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                  />
                </div>

                {/* Bottom bar with selectors */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
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

                  {/* Branch selector */}
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

            {/* Trigger Type - Segmented Control */}
            <div>
              <label className="block text-sm font-medium mb-2">Trigger</label>
              <div className={cn(
                "inline-flex rounded-md bg-muted p-0.5",
                isEditing && "opacity-50"
              )}>
                {TRIGGER_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => !isEditing && setTriggerType(t.value)}
                    disabled={isEditing}
                    className={cn(
                      "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                      triggerType === t.value
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule - only for scheduled trigger */}
            {triggerType === "interval" && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Run every</span>
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {INTERVAL_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>

                {/* Day of week - only for weekly */}
                {intervalMinutes === 10080 && (
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

                {/* Time of day - for daily and weekly */}
                {intervalMinutes >= 1440 && (
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
            )}

            {/* Options Section */}
            <div>
              <label className="block text-sm font-medium mb-2">Options</label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoPR"
                    checked={autoPR}
                    onChange={(e) => setAutoPR(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <label htmlFor="autoPR" className="text-sm">
                    Automatically create PR when there are commits
                  </label>
                </div>

                {/* Continue from last run - only for scheduled triggers */}
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
                      Include commits from the previous run
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
              onClick={onClose}
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
