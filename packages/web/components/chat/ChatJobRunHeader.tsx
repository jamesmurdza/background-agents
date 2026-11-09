"use client"

import { useState, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, RefreshCw, Clock, History, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { useScheduledJobQuery } from "@/lib/query/hooks/useScheduledJobQuery"
import { useScheduledJobRunsQuery } from "@/lib/query/hooks/useScheduledJobRunsQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { queryKeys } from "@/lib/query/keys"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import type { ChatScheduledJobRun } from "@/lib/scheduled-jobs/types"

interface ChatJobRunHeaderProps {
  /** The run linked to the chat currently open — see Chat.scheduledJobRun. */
  run: ChatScheduledJobRun
  /** Current chat id, to highlight it in the "previous runs" dropdown. */
  currentChatId: string
  /** Opens a chat by id — same mechanism used by the sidebar/Triggers modal. */
  onSelectChat: (chatId: string) => void
}

/**
 * Compact job context added to the chat's existing title row for chats
 * linked to a ScheduledJobRun — NOT a second header row. Shows a small
 * status indicator, a "previous runs" dropdown (since a job can have many
 * runs/chats and there's no other in-chat way to jump between them), and
 * the shared job actions menu (enable/disable, run now, rotate token,
 * edit, delete).
 */
export function ChatJobRunHeader({ run, currentChatId, onSelectChat }: ChatJobRunHeaderProps) {
  const queryClient = useQueryClient()
  // The chat response only embeds a subset of the job/run — fetch the full
  // job record (name may have changed since the run started, etc.) for the
  // actions menu/rename and for job-scoped actions.
  const { data: job } = useScheduledJobQuery(run.jobId)
  const { runNow, rotateToken, setEnabled, deleteJob } = useScheduledJobActions()

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const runsMenuRef = useRef<HTMLDivElement>(null)
  useClickOutside(runsMenuRef, () => setRunsOpen(false), runsOpen)

  const { data: runs = [] } = useScheduledJobRunsQuery(run.jobId, runsOpen)

  return (
    <div className="flex items-center gap-1 shrink-0">
      <RunStatusDot status={run.status} />

      <div className="relative" ref={runsMenuRef}>
        <button
          onClick={() => setRunsOpen((v) => !v)}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Previous runs"
        >
          <History className="h-3 w-3" />
          <ChevronDown className="h-3 w-3" />
        </button>

        {runsOpen && (
          <div className="absolute left-0 top-full mt-1 min-w-[220px] max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 z-50">
            {runs.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  disabled={!r.chatId}
                  onClick={() => {
                    if (r.chatId) onSelectChat(r.chatId)
                    setRunsOpen(false)
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors",
                    r.chatId ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-default",
                    r.chatId === currentChatId && "bg-accent/60"
                  )}
                >
                  <RunStatusDot status={r.status} />
                  <span className="flex-1 truncate">{format(r.startedAt, "MMM d, h:mma").toLowerCase()}</span>
                  {r.chatId === currentChatId && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {job && (
        <ScheduledJobActionsMenu
          job={job}
          onEdit={() => setEditOpen(true)}
          onRunNow={runNow}
          onToggleEnabled={(j, enabled) => setEnabled(j, enabled)}
          onRotateToken={rotateToken}
          onRequestDelete={() => setDeleteConfirmOpen(true)}
          editInMenu
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        />
      )}

      {job && (
        <>
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
        </>
      )}
    </div>
  )
}

/** Small colored dot reflecting a run's status — deliberately no text label
 *  (duration/PR details live in the Triggers modal, not repeated here). */
function RunStatusDot({ status }: { status: string }) {
  if (status === "running" || status === "pending") {
    return <RefreshCw className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
  }
  if (status === "error") {
    return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="Failed" />
  }
  if (status === "completed") {
    return <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Completed" />
  }
  return <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
}
