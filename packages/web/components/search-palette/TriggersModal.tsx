"use client"

import { useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Clock, Webhook, Check, X, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Switch } from "@/components/ui/switch"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { useScheduledJobsQuery } from "@/lib/query/hooks/useScheduledJobsQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"

interface TriggersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens a chat by id — same mechanism used to open any sidebar chat row.
   *  Clicking a job row navigates to its most recent run's chat (the real,
   *  interactive chat view with the job header strip on top) rather than
   *  the old standalone report view. */
  onSelectChat: (chatId: string) => void
}

/** Last run date, or blank if the job has never run. */
function lastRunLabel(job: { lastRun: { startedAt: number } | null }): string {
  return job.lastRun ? format(job.lastRun.startedAt, "MMM d, h:mm a") : ""
}

/** Small icon reflecting a run's status — scannable at a glance without
 *  needing a text label for the common cases. */
function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === "error") {
    return <X className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
  }
  if (status === "running" || status === "pending") {
    return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
  }
  return null
}

/** Status icon + when it last ran, or "Never run" if the job hasn't fired yet. */
function LastRunBadge({ job }: { job: { lastRun: { status: string; startedAt: number } | null } }) {
  if (!job.lastRun) {
    return <span className="text-sm text-muted-foreground">Never run</span>
  }
  return (
    <div className="flex items-center gap-1.5">
      <StatusIcon status={job.lastRun.status} />
      <span className="text-xs text-muted-foreground">{lastRunLabel(job)}</span>
    </div>
  )
}

/** Icon reflecting how the job is triggered — a schedule vs. an incoming webhook. */
function TriggerTypeCell({ job }: { job: { triggerType: string } }) {
  return job.triggerType === "incoming" ? (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Webhook className="h-3.5 w-3.5" /> Webhook
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Clock className="h-3.5 w-3.5" /> Interval
    </span>
  )
}

/**
 * "Triggers" modal — lists all scheduled jobs in a table (name, trigger type,
 * next run, enabled, last run status, actions). Replaces the old "Agents"
 * command-palette (SearchJobsPalette) with a standard modal dialog, since
 * this is a browse/manage surface rather than a fuzzy-search one. Clicking a
 * row still navigates to the job detail view, matching the old behavior.
 */
export function TriggersModal({ open, onOpenChange, onSelectChat }: TriggersModalProps) {
  const { data: jobs = [] } = useScheduledJobsQuery()
  const { runNow, rotateToken, setEnabled, deleteJob } = useScheduledJobActions()

  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deletingJob, setDeletingJob] = useState<ScheduledJob | null>(null)

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  )

  const handleSelect = (job: ScheduledJob) => {
    // Navigate straight to the most recent run's chat — the real,
    // interactive chat view (with the job header strip on top), same as
    // clicking that chat's row in the sidebar. There's no longer a
    // standalone job report view to fall back to.
    if (job.lastRun?.chatId) {
      onSelectChat(job.lastRun.chatId)
    }
    onOpenChange(false)
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={cn(
            MODAL_OVERLAY_CLASS,
            "transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )} />
          <Dialog.Content
            onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[80vh] flex flex-col bg-popover border border-border rounded-xl shadow-xl"
          >
            <ModalHeader
              title={
                <>
                  <Clock className="h-4 w-4" />
                  Triggers
                </>
              }
            />

            <div className="p-4 overflow-y-auto">
              {sortedJobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No scheduled jobs found.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-foreground/70 border-b border-border">
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Trigger type</th>
                      <th className="px-3 py-2">Next run</th>
                      <th className="px-3 py-2">Last run</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer"
                        onClick={() => handleSelect(job)}
                      >
                        <td className="px-3 py-2.5">
                          <Switch
                            checked={job.enabled}
                            onCheckedChange={(enabled) => setEnabled(job, enabled)}
                            aria-label={job.enabled ? "Disable job" : "Enable job"}
                          />
                        </td>
                        <td className="px-3 py-2.5 truncate max-w-[14rem]">{job.name}</td>
                        <td className="px-3 py-2.5"><TriggerTypeCell job={job} /></td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {job.triggerType === "interval" ? format(job.nextRunAt, "MMM d, h:mm a") : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <LastRunBadge job={job} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                            <ScheduledJobActionsMenu
                              job={job}
                              onEdit={setEditingJob}
                              onRunNow={runNow}
                              onRotateToken={rotateToken}
                              onRequestDelete={setDeletingJob}
                              stopPropagation
                              editInMenu
                              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ScheduledJobForm
        open={!!editingJob}
        job={editingJob ?? undefined}
        onClose={() => setEditingJob(null)}
        onSuccess={() => setEditingJob(null)}
      />

      <ConfirmDialog
        open={!!deletingJob}
        title="Delete scheduled job?"
        description={deletingJob ? `This will permanently delete "${deletingJob.name}" and all its run history.` : ""}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deletingJob) void deleteJob(deletingJob)
          setDeletingJob(null)
        }}
        onClose={() => setDeletingJob(null)}
      />
    </>
  )
}
