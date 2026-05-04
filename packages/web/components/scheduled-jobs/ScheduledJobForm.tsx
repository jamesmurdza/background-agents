"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useReposQuery, useBranchesQueryFromFullName } from "@/lib/query"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobFormProps {
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
}

// =============================================================================
// Interval Options
// =============================================================================

const INTERVAL_PRESETS = [
  { label: "Hourly", value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Daily", value: 1440 },
  { label: "Weekly", value: 10080 },
  { label: "Custom", value: -1 },
]

const AGENT_OPTIONS = [
  { label: "OpenCode", value: "opencode" },
  { label: "Claude Code", value: "claude-code" },
  { label: "Codex", value: "codex" },
]

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobForm({ job, onClose, onSuccess }: ScheduledJobFormProps) {
  const isEditing = !!job

  // Form state
  const [name, setName] = useState(job?.name ?? "")
  const [prompt, setPrompt] = useState(job?.prompt ?? "")
  const [repo, setRepo] = useState(job?.repo ?? "")
  const [baseBranch, setBaseBranch] = useState(job?.baseBranch ?? "main")
  const [agent, setAgent] = useState(job?.agent ?? "opencode")
  const [intervalMinutes, setIntervalMinutes] = useState(job?.intervalMinutes ?? 1440)
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [customInterval, setCustomInterval] = useState("")
  const [customUnit, setCustomUnit] = useState<"hours" | "days">("hours")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch repos and branches
  const { data: repos, isLoading: loadingRepos } = useReposQuery()
  const { data: branches, isLoading: loadingBranches } = useBranchesQueryFromFullName(repo || null)

  // Update branch when repo changes
  useEffect(() => {
    if (branches && branches.length > 0 && !job) {
      const defaultBranch = branches.find((b: GitHubBranch) => b.name === "main") || branches[0]
      setBaseBranch(defaultBranch.name)
    }
  }, [branches, job])

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

    // Calculate interval
    let finalInterval = intervalMinutes
    if (isCustomInterval && customInterval) {
      const num = parseInt(customInterval, 10)
      if (isNaN(num) || num < 1) {
        setError("Invalid interval")
        return
      }
      finalInterval = customUnit === "hours" ? num * 60 : num * 1440
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
          intervalMinutes: finalInterval,
          autoPR,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background border border-border shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">
            {isEditing ? "Edit Scheduled Job" : "New Scheduled Job"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
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

          {/* Repository */}
          <div>
            <label className="block text-sm font-medium mb-1">Repository</label>
            <select
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={loadingRepos || isEditing}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">Select a repository</option>
              {repos?.map((r: GitHubRepo) => (
                <option key={r.full_name} value={r.full_name}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Branch */}
          <div>
            <label className="block text-sm font-medium mb-1">Base Branch</label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={loadingBranches || !repo}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {branches?.map((b: GitHubBranch) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Agent */}
          <div>
            <label className="block text-sm font-medium mb-1">Agent</label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {AGENT_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          {/* Interval */}
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

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

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

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving..." : isEditing ? "Save Changes" : "Create Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
