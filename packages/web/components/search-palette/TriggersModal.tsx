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
   *  Clicking the last-run button for a job navigates to its most recent
   *  run's chat (the real, interactive chat view with the job header strip
   *  on top) rather than the old standalone report view. */
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

/** Status icon + when it last ran, as a button that opens that run's chat
 *  (or plain "Never run" text if the job hasn't fired yet — nothing to open). */
function LastRunBadge({ job, onSelect }: { job: { lastRun: { status: string; startedAt: number; chatId: string | null } | null }; onSelect: () => void }) {
  if (!job.lastRun) {
    return <span className="px-1.5 py-1 text-xs text-muted-foreground">Never run</span>
  }
  return (
    <button
      onClick={onSelect}
      disabled={!job.lastRun.chatId}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
    >
      <StatusIcon status={job.lastRun.status} />
      <span className="text-xs text-muted-foreground">{lastRunLabel(job)}</span>
    </button>
  )
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]

/** Plain-English description of when a job runs, derived from
 *  intervalMinutes + nextRunAt (there's no separate stored "day of week" —
 *  the form only uses that to compute nextRunAt, so we read it back out of
 *  that timestamp here). */
function describeTrigger(job: { triggerType: string; intervalMinutes: number; nextRunAt: number }): string {
  if (job.triggerType === "incoming") return "Incoming webhook"

  const { intervalMinutes, nextRunAt } = job
  const time = format(nextRunAt, "h:mma").toLowerCase()

  if (intervalMinutes === 10080) {
    return `Weekly on ${WEEKDAYS[new Date(nextRunAt).getDay()]} at ${time}`
  }
  if (intervalMinutes === 1440) {
    return `Daily at ${time}`
  }
  if (intervalMinutes === 60) {
    return "Hourly"
  }
  if (intervalMinutes % 1440 === 0) {
    return `Every ${intervalMinutes / 1440} days`
  }
  if (intervalMinutes % 60 === 0) {
    return `Every ${intervalMinutes / 60} hours`
  }
  return `Every ${intervalMinutes} minutes`
}

/** Trigger description + next run time (for interval jobs — webhooks have
 *  no "next run"). */
function TriggerCell({ job }: { job: { triggerType: string; intervalMinutes: number; nextRunAt: number } }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {job.triggerType === "incoming" ? (
        <Webhook className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Clock className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{describeTrigger(job)}</span>
    </div>
  )
}

/**
 * "Triggers" modal — lists all scheduled jobs as card-style rows (enabled
 * switch, name + trigger description, last-run status, actions), styled to
 * match the settings modal's Deployments tab (DeploymentsSection.tsx) rather
 * than a dense data-grid table. Replaces the old "Agents" command-palette
 * (SearchJobsPalette) with a standard modal dialog, since this is a browse/
 * manage surface rather than a fuzzy-search one. Rows themselves aren't
 * clickable — the last-run text is its own button that opens that run's
 * chat, so it doesn't compete with the switch/actions also in the row.
 */
export function TriggersModal({ open, onOpenChange, onSelectChat }: TriggersModalProps) {
  const { data: jobs = [] } = useScheduledJobsQuery()
  const { runNow, setEnabled, deleteJob } = useScheduledJobActions()

  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deletingJob, setDeletingJob] = useState<ScheduledJob | null>(null)

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  )

  const handleSelectRun = (job: ScheduledJob) => {
    // Navigate straight to the most recent run's chat — the real,
    // interactive chat view (with the job header strip on top), same as
    // clicking that chat's row in the sidebar. There's no longer a
    // standalone job report view to fall back to.
    if (job.lastRun?.chatId) {
      onSelectChat(job.lastRun.chatId)
      onOpenChange(false)
    }
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
                <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
                  No scheduled jobs found.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {sortedJobs.map((job) => (
                    <li
                      key={job.id}
                      className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2.5"
                    >
                      <div className="shrink-0">
                        <Switch
                          checked={job.enabled}
                          onCheckedChange={(enabled) => setEnabled(job, enabled)}
                          aria-label={job.enabled ? "Disable job" : "Enable job"}
                        />
                      </div>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="truncate text-sm font-medium">{job.name}</div>
                        <div className="truncate text-xs">
                          <TriggerCell job={job} />
                        </div>
                      </div>

                      <div className="shrink-0">
                        <LastRunBadge job={job} onSelect={() => handleSelectRun(job)} />
                      </div>

                      <div className="shrink-0">
                        <ScheduledJobActionsMenu
                          job={job}
                          onEdit={setEditingJob}
                          onRunNow={runNow}
                          onRequestDelete={setDeletingJob}
                          editInMenu
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
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
