"use client"

import { useState, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Check, GitPullRequest, RefreshCw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { useScheduledJobQuery } from "@/lib/query/hooks/useScheduledJobQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { queryKeys } from "@/lib/query/keys"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { formatDurationRange } from "@/lib/format"
import type { ChatScheduledJobRun } from "@/lib/scheduled-jobs/types"

interface ChatJobRunHeaderProps {
  /** The run linked to the chat currently open — see Chat.scheduledJobRun. */
  run: ChatScheduledJobRun
}

/**
 * Header strip shown above the chat for a chat linked to a ScheduledJobRun —
 * the merged replacement for the old standalone report view
 * (ScheduledJobDetailPanel/JobRunDetail). Shows the job's (editable) name,
 * this run's outcome summary, and the shared job actions menu. The chat
 * below this strip is the normal, fully-interactive ChatPanel — no separate
 * read-only message list anymore.
 *
 * Deliberately has no run-switcher: the sidebar already lists every run of
 * a job as its own chat row, so browsing between runs happens there.
 */
export function ChatJobRunHeader({ run }: ChatJobRunHeaderProps) {
  const queryClient = useQueryClient()
  // The chat response only embeds a subset of the job/run — fetch the full
  // job record (name may have changed since the run started, etc.) for the
  // actions menu and rename, keyed off the shared React Query cache so a
  // rename from here or from the Triggers modal stays in sync everywhere.
  const { data: job } = useScheduledJobQuery(run.jobId)
  const { runNow, rotateToken, setEnabled, rename, deleteJob } = useScheduledJobActions()

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Title editing state — same inline-rename pattern as ChatHeader/JobRunDetail.
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState("")
  const titleInputRef = useRef<HTMLInputElement>(null)

  if (!job) {
    // Job query hasn't resolved yet (or the job was deleted and the cache
    // entry was removed) — rather than flash a skeleton, just show nothing;
    // the run summary below still renders from the chat's embedded data.
    return (
      <RunOutcomeSummary run={run} titleFallback={run.jobName} />
    )
  }

  const startEditingTitle = () => {
    setEditTitleValue(job.name)
    setIsEditingTitle(true)
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 0)
  }

  const saveTitle = () => {
    const trimmed = editTitleValue.trim()
    if (trimmed && trimmed !== job.name) {
      void rename(job, trimmed)
    }
    setIsEditingTitle(false)
  }

  const cancelEditingTitle = () => {
    setIsEditingTitle(false)
    setEditTitleValue("")
  }

  return (
    <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}>
      <div className="flex items-center gap-2 min-w-0">
        {isEditingTitle ? (
          <Input
            ref={titleInputRef}
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle()
              if (e.key === "Escape") cancelEditingTitle()
            }}
            onBlur={saveTitle}
            className="w-56 font-medium"
          />
        ) : (
          <button
            onClick={startEditingTitle}
            className="flex h-7 items-center min-w-0 text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-pointer"
            title="Click to rename"
          >
            <span className="truncate">{job.name}</span>
          </button>
        )}

        <RunOutcomeSummary run={run} compact />
      </div>

      <div className="flex items-center gap-1.5">
        <ScheduledJobActionsMenu
          job={job}
          onEdit={() => setEditOpen(true)}
          onRunNow={runNow}
          onToggleEnabled={(j, enabled) => setEnabled(j, enabled)}
          onRotateToken={rotateToken}
          onRequestDelete={() => setDeleteConfirmOpen(true)}
        />
      </div>

      <ScheduledJobForm
        open={editOpen}
        job={job}
        onClose={() => setEditOpen(false)}
        onSuccess={(updated) => {
          setEditOpen(false)
          queryClient.setQueryData<ScheduledJob>(queryKeys.scheduledJobs.detail(updated.id), updated)
          queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) =>
            old.map((j) => (j.id === updated.id ? updated : j))
          )
        }}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete scheduled job?"
        description={`This will permanently delete "${job.name}" and all its run history.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          void deleteJob(job)
          setDeleteConfirmOpen(false)
        }}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    </div>
  )
}

/**
 * Run outcome summary — ported verbatim (just restyled for the header strip
 * instead of the old message-list footer) from JobRunDetail's completion/
 * error/PR messaging so the wording users already know stays the same.
 */
function RunOutcomeSummary({ run, compact, titleFallback }: { run: ChatScheduledJobRun; compact?: boolean; titleFallback?: string }) {
  return (
    <div className={compact ? "flex items-center gap-3 text-xs text-muted-foreground min-w-0" : "px-2 text-sm text-muted-foreground"}>
      {!compact && titleFallback && <span className="font-medium text-foreground mr-2">{titleFallback}</span>}

      {run.status === "running" && (
        <span className="flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Running…
        </span>
      )}

      {run.status === "error" && run.error && (
        <span className="flex items-center gap-1.5 text-destructive truncate" title={run.error}>
          Run failed
        </span>
      )}

      {run.status === "completed" && run.completedAt && (
        <span className="flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
          Finished after {formatDurationRange(run.startedAt, run.completedAt)}
        </span>
      )}

      {run.status === "completed" && run.prUrl && (
        <a
          href={run.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <GitPullRequest className="h-3 w-3 text-green-600 dark:text-green-400" />
          Created PR #{run.prNumber}
        </a>
      )}

      {run.status === "pending" && (
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Pending…
        </span>
      )}
    </div>
  )
}
