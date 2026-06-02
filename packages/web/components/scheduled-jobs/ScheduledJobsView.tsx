"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Clock, Plus } from "lucide-react"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { JobsList } from "@/components/scheduled-jobs/JobsList"
import { JobRunDetail } from "@/components/scheduled-jobs/JobRunDetail"
import { type ScheduledJob, type ScheduledJobRun } from "@/lib/scheduled-jobs/types"
import type { Message } from "@/lib/types"

// =============================================================================
// Props
// =============================================================================

interface ScheduledJobsViewProps {
  onOpenForm?: () => void
  /** Increment to trigger a refresh of the jobs list */
  refreshKey?: number
  /** Job ID from URL - controls which job is selected (null = show list) */
  urlJobId: string | null
  /** Callback when navigating to a job (updates URL and sidebar state) */
  onNavigateToJob?: (jobId: string | null, jobName?: string) => void
}

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobsView({ onOpenForm, refreshKey, urlJobId, onNavigateToJob }: ScheduledJobsViewProps) {
  const { data: session } = useSession()

  // The selected job ID - derived directly from URL
  const selectedJobId = urlJobId

  // Handler to change selected job - notifies parent to update URL
  const setSelectedJobId = (jobId: string | null, jobName?: string) => {
    onNavigateToJob?.(jobId, jobName)
  }

  // Jobs list state
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form/modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deleteJob, setDeleteJob] = useState<ScheduledJob | null>(null)

  // Detail view state
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null)
  const [runs, setRuns] = useState<ScheduledJobRun[]>([])
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRun | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  // Reset detail state when returning to list view
  // Note: Don't call setSelectedJobId here - URL changes should drive navigation
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null)
    }
  }, [selectedJobId])

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
      <JobRunDetail
        job={selectedJob}
        runs={runs}
        selectedRun={selectedRun}
        onSelectRun={setSelectedRun}
        messages={messages}
      />
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* List Header - styled like chat header */}
      <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1.625rem" }}>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-default">
            Scheduled Agents
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
          <div className="flex flex-col items-center justify-center py-16 pt-24 text-center">
            <Clock className="h-6 w-6 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mt-1">
              Create a scheduled job to run agents automatically
            </p>
          </div>
        ) : (
          <JobsList
            jobs={jobs}
            onSelect={setSelectedJobId}
            onEdit={handleEdit}
            onRunNow={handleRunNow}
            onRequestDelete={setDeleteJob}
          />
        )}
      </main>

      {/* Form Modal */}
      <ScheduledJobForm
        open={formOpen}
        job={editingJob}
        onClose={() => {
          setFormOpen(false)
          setEditingJob(null)
        }}
        onSuccess={handleFormSuccess}
      />

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
