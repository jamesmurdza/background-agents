"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { JobRunDetail } from "@/components/scheduled-jobs/JobRunDetail"
import { JobRunDetailSkeleton } from "@/components/scheduled-jobs/JobRunDetailSkeleton"
import { useScheduledJobQuery } from "@/lib/query/hooks/useScheduledJobQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { type ScheduledJob, type ScheduledJobRun } from "@/lib/scheduled-jobs/types"
import type { Message } from "@/lib/types"

// =============================================================================
// Props
// =============================================================================

interface ScheduledJobDetailPanelProps {
  /** Job ID from the URL (/jobs/[jobId]). */
  jobId: string
  /** Callback when the job is deleted — navigates back out of the detail view. */
  onNavigateAway: () => void
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a single scheduled job's detail/run history (the content behind
 * /jobs/[jobId]). Jobs are now created via the chat composer's popover and
 * browsed via the "Triggers" modal — this panel only owns the
 * run/message fetching for the detail view itself; the job record comes from
 * the shared React Query cache (`useScheduledJobQuery`) so a title patched
 * elsewhere (e.g. the fire-and-forget rename after creation) is reflected
 * here without a manual refresh.
 */
export function ScheduledJobDetailPanel({ jobId, onNavigateAway }: ScheduledJobDetailPanelProps) {
  const { data: session } = useSession()
  const { data: job, isLoading: jobLoading } = useScheduledJobQuery(jobId)
  const { runNow, rotateToken, setEnabled, rename, deleteJob } = useScheduledJobActions()

  const [runs, setRuns] = useState<ScheduledJobRun[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRun | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch job runs for the selected job. Resets all job-scoped state
  // synchronously on jobId change — otherwise the previous job's runs/
  // selectedRun/messages stay on screen (behind the already-updated header,
  // since that's driven reactively by useScheduledJobQuery) until this
  // fetch resolves, making it look like you navigated to a different job
  // but the chat didn't change.
  useEffect(() => {
    setRuns([])
    setSelectedRun(null)
    setMessages([])
    setError(null)

    if (!session || !jobId) {
      setRunsLoading(false)
      return
    }

    let cancelled = false
    let isFirstFetch = true
    setRunsLoading(true)

    const fetchRuns = async () => {
      try {
        const runsRes = await fetch(`/api/scheduled-jobs/${jobId}/runs`)
        if (!runsRes.ok) throw new Error("Failed to fetch runs")
        const runsData = await runsRes.json()
        if (cancelled) return
        setRuns(runsData.runs)
        if (runsData.runs.length > 0) {
          setSelectedRun(runsData.runs[0])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        if (isFirstFetch && !cancelled) {
          setRunsLoading(false)
          isFirstFetch = false
        }
      }
    }

    fetchRuns()
    const interval = setInterval(fetchRuns, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [session, jobId])

  // Fetch messages when the selected run changes.
  useEffect(() => {
    if (!selectedRun?.chatId) {
      setMessages([])
      setMessagesLoading(false)
      return
    }

    let cancelled = false
    let isFirstFetch = true

    const fetchMessages = async () => {
      if (isFirstFetch) setMessagesLoading(true)
      try {
        const res = await fetch(`/api/chats/${selectedRun.chatId}/messages`)
        if (!res.ok) throw new Error("Failed to fetch messages")
        const data = await res.json()
        if (!cancelled) setMessages(data.messages || [])
      } catch (err) {
        console.error("Failed to fetch messages:", err)
        if (!cancelled) setMessages([])
      } finally {
        if (isFirstFetch && !cancelled) {
          setMessagesLoading(false)
          isFirstFetch = false
        }
      }
    }

    fetchMessages()
    let interval: ReturnType<typeof setInterval> | undefined
    if (selectedRun.status === "running") {
      interval = setInterval(fetchMessages, 5000)
    }
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [selectedRun?.chatId, selectedRun?.status])

  const handleRunNow = (j: ScheduledJob) => runNow(j)
  const handleRotateToken = (j: ScheduledJob) => rotateToken(j)
  const handleToggleEnabled = (j: ScheduledJob, enabled: boolean) => setEnabled(j, enabled)
  const handleRename = (j: ScheduledJob, name: string) => rename(j, name)

  const handleDelete = async (j: ScheduledJob): Promise<boolean> => {
    const ok = await deleteJob(j)
    if (ok) onNavigateAway()
    return ok
  }

  if (jobLoading && !job) {
    return <JobRunDetailSkeleton />
  }

  if (!job) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">
          {error ?? "Scheduled job not found"}
        </div>
      </div>
    )
  }

  return (
    <JobRunDetail
      job={job}
      runs={runs}
      runsLoading={runsLoading}
      selectedRun={selectedRun}
      onSelectRun={setSelectedRun}
      messages={messages}
      messagesLoading={messagesLoading}
      onRunNow={handleRunNow}
      onRotateToken={handleRotateToken}
      onToggleEnabled={handleToggleEnabled}
      onRename={handleRename}
      onDelete={handleDelete}
    />
  )
}
