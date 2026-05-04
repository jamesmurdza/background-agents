"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Clock, Plus, MoreHorizontal, Play, Pencil, Trash2, AlertCircle, Check, X, ArrowLeft, ChevronDown, ExternalLink, GitPullRequest, CheckCircle2, XCircle, Circle, RefreshCw } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { MessageBubble } from "@/components/MessageBubble"
import { type ScheduledJob, type ScheduledJobRun, formatInterval } from "@/lib/scheduled-jobs/types"
import type { Message } from "@/lib/types"

// =============================================================================
// Helpers
// =============================================================================

function getJobStatusIcon(job: ScheduledJob) {
  if (!job.enabled) {
    return <X className="h-3.5 w-3.5 text-muted-foreground" />
  }
  if (job.lastRun?.status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
  if (job.lastRun?.status === "completed") {
    return <Check className="h-3.5 w-3.5 text-green-500" />
  }
  if (job.lastRun?.status === "running") {
    return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
}

function getRunStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    case "running":
      return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function getLastRunText(job: ScheduledJob): string {
  if (!job.lastRun) return "Never run"

  const timeAgo = formatDistanceToNow(job.lastRun.startedAt, { addSuffix: true })

  if (job.lastRun.status === "running") {
    return `Running ${timeAgo}`
  }
  if (job.lastRun.status === "error") {
    return `Failed ${timeAgo}`
  }
  if (job.lastRun.prUrl) {
    return `PR #${job.lastRun.prNumber} ${timeAgo}`
  }
  if (job.lastRun.status === "completed") {
    return `No changes ${timeAgo}`
  }
  return timeAgo
}

function formatRunLabel(run: ScheduledJobRun): string {
  return format(run.startedAt, "MMM d, h:mm a")
}

function formatDuration(startedAt: number, completedAt: number): string {
  const durationMs = completedAt - startedAt
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}

// =============================================================================
// Props
// =============================================================================

interface ScheduledJobsViewProps {
  onOpenForm?: () => void
  /** Increment to trigger a refresh of the jobs list */
  refreshKey?: number
  /** Callback when a job is selected/deselected (for sidebar integration) */
  onJobSelect?: (job: ScheduledJob | null) => void
  /** When true, reset to show the list view (clear any selected job) */
  showList?: boolean
}

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobsView({ onOpenForm, refreshKey, onJobSelect, showList }: ScheduledJobsViewProps) {
  const { data: session } = useSession()

  // View state: list or detail
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  // Jobs list state
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form/modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deleteJob, setDeleteJob] = useState<ScheduledJob | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // Detail view state
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null)
  const [runs, setRuns] = useState<ScheduledJobRun[]>([])
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRun | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Notify parent when job selection changes
  useEffect(() => {
    onJobSelect?.(selectedJob)
  }, [selectedJob, onJobSelect])

  // Reset to list view when showList becomes true
  useEffect(() => {
    if (showList) {
      setSelectedJobId(null)
      setSelectedJob(null)
    }
  }, [showList])

  // Fetch jobs list
  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/scheduled-jobs")
      if (!res.ok) throw new Error("Failed to fetch jobs")
      const data = await res.json()
      setJobs(data.jobs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchJobs()
      const interval = setInterval(fetchJobs, 30000)
      return () => clearInterval(interval)
    }
  }, [session, refreshKey])

  // Fetch job detail when selected
  useEffect(() => {
    if (!session || !selectedJobId) {
      setSelectedJob(null)
      setRuns([])
      setSelectedRun(null)
      setMessages([])
      return
    }

    const fetchJobDetail = async () => {
      try {
        const [jobRes, runsRes] = await Promise.all([
          fetch(`/api/scheduled-jobs/${selectedJobId}`),
          fetch(`/api/scheduled-jobs/${selectedJobId}/runs`),
        ])

        if (!jobRes.ok) throw new Error("Failed to fetch job")
        if (!runsRes.ok) throw new Error("Failed to fetch runs")

        const jobData = await jobRes.json()
        const runsData = await runsRes.json()

        setSelectedJob(jobData)
        setRuns(runsData.runs)

        if (runsData.runs.length > 0) {
          setSelectedRun(runsData.runs[0])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    }

    fetchJobDetail()
    const interval = setInterval(fetchJobDetail, 30000)
    return () => clearInterval(interval)
  }, [session, selectedJobId])

  // Fetch messages when selected run changes
  useEffect(() => {
    if (!selectedRun?.chatId) {
      setMessages([])
      return
    }

    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/chats/${selectedRun.chatId}/messages`)
        if (!res.ok) throw new Error("Failed to fetch messages")
        const data = await res.json()
        setMessages(data.messages || [])
      } catch (err) {
        console.error("Failed to fetch messages:", err)
        setMessages([])
      }
    }

    fetchMessages()
    if (selectedRun.status === "running") {
      const interval = setInterval(fetchMessages, 5000)
      return () => clearInterval(interval)
    }
  }, [selectedRun?.chatId, selectedRun?.status])

  // Handlers
  const handleCreate = () => {
    if (onOpenForm) {
      onOpenForm()
    } else {
      setEditingJob(null)
      setFormOpen(true)
    }
  }

  const handleEdit = (job: ScheduledJob) => {
    setEditingJob(job)
    setFormOpen(true)
    setMenuOpenId(null)
  }

  const handleDelete = async () => {
    if (!deleteJob) return

    try {
      const res = await fetch(`/api/scheduled-jobs/${deleteJob.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete job")
      setJobs((prev) => prev.filter((j) => j.id !== deleteJob.id))
      if (selectedJobId === deleteJob.id) {
        setSelectedJobId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
    } finally {
      setDeleteJob(null)
    }
  }

  const handleRunNow = async (job: ScheduledJob) => {
    setMenuOpenId(null)
    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}/run`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to trigger run")
      fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger run")
    }
  }

  const handleFormSuccess = (job: ScheduledJob) => {
    setFormOpen(false)
    if (editingJob) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)))
      if (selectedJobId === job.id) {
        setSelectedJob(job)
      }
    } else {
      setJobs((prev) => [job, ...prev])
    }
    setEditingJob(null)
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Detail view
  if (selectedJobId && selectedJob) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Detail Header - styled like chat header */}
        <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}>
          <div className="flex items-center gap-2">
            {/* Title - styled like chat title */}
            <span className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-default">
              {selectedJob.name}
            </span>
          </div>

          {/* Run selector dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              {selectedRun ? (
                <>
                  {getRunStatusIcon(selectedRun.status)}
                  <span className="text-sm">{formatRunLabel(selectedRun)}</span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">No runs yet</span>
              )}
              <ChevronDown className={cn("h-4 w-4 transition-transform", dropdownOpen && "rotate-180")} />
            </button>

            {dropdownOpen && runs.length > 0 && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => {
                        setSelectedRun(run)
                        setDropdownOpen(false)
                      }}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left",
                        run.id === selectedRun?.id && "bg-accent"
                      )}
                    >
                      {getRunStatusIcon(run.status)}
                      <span className="flex-1">{formatRunLabel(run)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Detail Content */}
        <main className="flex-1 overflow-auto">
          {selectedRun ? (
            <div className="max-w-4xl mx-auto p-6">
              {/* Error display */}
              {selectedRun.error && (
                <div className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <div className="font-medium mb-1">Run failed</div>
                  <div className="whitespace-pre-wrap">{selectedRun.error}</div>
                </div>
              )}

              {/* Messages */}
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {selectedRun.status === "running" ? (
                      <div className="flex items-center justify-center gap-2">
                        <Clock className="h-4 w-4 animate-pulse" />
                        Agent is running...
                      </div>
                    ) : (
                      "No messages for this run"
                    )}
                  </div>
                ) : (
                  <>
                    {messages.map((message, index) => (
                      <MessageBubble
                        key={message.id || index}
                        message={message}
                        isStreaming={selectedRun.status === "running" && index === messages.length - 1}
                      />
                    ))}

                    {/* Completion summary - styled like system messages */}
                    {selectedRun.status === "completed" && selectedRun.completedAt && (
                      <div className="flex items-start gap-2 text-sm">
                        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                        <span className="text-muted-foreground">
                          Agent finished after {formatDuration(selectedRun.startedAt, selectedRun.completedAt)}.
                        </span>
                      </div>
                    )}

                    {/* PR created message */}
                    {selectedRun.status === "completed" && selectedRun.prUrl && (
                      <div className="flex items-start gap-2 text-sm">
                        <GitPullRequest className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                        <a
                          href={selectedRun.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Created PR #{selectedRun.prNumber}.
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-medium mb-2">No runs yet</h2>
              <p className="text-muted-foreground">
                This job will run {formatDistanceToNow(selectedJob.nextRunAt, { addSuffix: true })}
              </p>
            </div>
          )}
        </main>
      </div>
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* List Header - styled like chat header */}
      <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1.625rem" }}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-default">
            Scheduled Jobs
          </span>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      {/* List Content */}
      <main className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mt-1">
              Create a scheduled job to run agents automatically
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Repository</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Every</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Last Run</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getJobStatusIcon(job)}
                        <span className={cn(
                          "text-sm font-medium",
                          !job.enabled && "text-muted-foreground"
                        )}>
                          {job.name}
                        </span>
                        {!job.enabled && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Disabled
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {job.repo}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {formatInterval(job.intervalMinutes)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <span className={cn(
                        job.lastRun?.status === "error" && "text-destructive"
                      )}>
                        {getLastRunText(job)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="relative inline-block">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpenId(menuOpenId === job.id ? null : job.id)
                          }}
                          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>

                        {menuOpenId === job.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuOpenId(null)
                              }}
                            />
                            <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-popover py-1 shadow-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEdit(job)
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRunNow(job)
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                              >
                                <Play className="h-3.5 w-3.5" />
                                Run Now
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpenId(null)
                                  setDeleteJob(job)
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Form Modal */}
      {formOpen && (
        <ScheduledJobForm
          job={editingJob}
          onClose={() => {
            setFormOpen(false)
            setEditingJob(null)
          }}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteJob}
        title="Delete scheduled job?"
        description={`This will permanently delete "${deleteJob?.name}" and all its run history.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        onClose={() => setDeleteJob(null)}
      />
    </div>
  )
}
