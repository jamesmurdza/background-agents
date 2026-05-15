"use client"

import { useState, useEffect } from "react"
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
  { label: "Run on Schedule", value: "interval" },
  { label: "Run on CI/CD Failure", value: "webhook" },
] as const

const INTERVAL_PRESETS = [
  { label: "Hourly", value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Daily", value: 1440 },
  { label: "Weekly", value: 10080 },
  { label: "Custom", value: -1 },
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
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(job?.continueFromLastRun ?? false)
  const [customInterval, setCustomInterval] = useState("")
  const [customUnit, setCustomUnit] = useState<"hours" | "days">("hours")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  // Get available models for selected agent
  const availableModels = agentModels[agent] ?? []

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
      setAutoPR(job?.autoPR ?? true)
      setContinueFromLastRun(job?.continueFromLastRun ?? false)
      setCustomInterval("")
      setCustomUnit("hours")
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

  // Check if using custom interval
  const isCustomInterval = !INTERVAL_PRESETS.find((p) => p.value === intervalMinutes && p.value !== -1)

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

    // Calculate interval (only for interval trigger type)
    let finalInterval = intervalMinutes
    if (triggerType === "interval") {
      if (isCustomInterval && customInterval) {
        const num = parseInt(customInterval, 10)
        if (isNaN(num) || num < 1) {
          setError("Invalid interval")
          return
        }
        finalInterval = customUnit === "hours" ? num * 60 : num * 1440
      }
    }

    setLoading(true)

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
          intervalMinutes: triggerType === "interval" ? finalInterval : undefined,
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
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg border border-border rounded-lg shadow-xl max-h-[90vh]"
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
                  />

                  {/* Branch selector */}
                  {repo && (
                    <BranchCombobox
                      repo={repo}
                      value={baseBranch}
                      onChange={setBaseBranch}
                      defaultBranch={baseBranch}
                      isMobile={isMobile}
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

            {/* Trigger Type */}
            <div>
              <label className="block text-sm font-medium mb-1">Trigger</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as "interval" | "webhook")}
                disabled={isEditing}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {TRIGGER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Webhook info */}
            {triggerType === "webhook" && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                This agent will run whenever a GitHub Actions workflow fails on this repository.
                A webhook will be created on the repository when you save.
              </div>
            )}

            {/* Interval - only show for interval trigger */}
            {triggerType === "interval" && (
              <div>
                <label className="block text-sm font-medium mb-1">Run Every</label>
                <div className="flex gap-2">
                  <select
                    value={isCustomInterval ? -1 : intervalMinutes}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (val === -1) {
                        setCustomInterval("")
                      } else {
                        setIntervalMinutes(val)
                      }
                    }}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {INTERVAL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {isCustomInterval && (
                    <>
                      <input
                        type="number"
                        min="1"
                        value={customInterval}
                        onChange={(e) => setCustomInterval(e.target.value)}
                        placeholder="1"
                        className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value as "hours" | "days")}
                        className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Auto-PR */}
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

            {/* Continue from last run */}
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
