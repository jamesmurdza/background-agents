"use client"

import { useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Webhook, Play } from "lucide-react"
import { format } from "date-fns"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Switch } from "@/components/ui/switch"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { useScheduledJobsQuery } from "@/lib/query/hooks/useScheduledJobsQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { useSidebar } from "@/lib/contexts"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { queryKeys } from "@/lib/query/keys"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"

interface TriggersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Last run date, or blank if the job has never run. */
function lastRunLabel(job: { lastRun: { startedAt: number } | null }): string {
  return job.lastRun ? format(job.lastRun.startedAt, "MMM d, h:mm a") : ""
}

/** Reuses JobRunDetail/ScheduledJobDetailPanel's plain status strings — no new taxonomy. */
function lastRunStatusLabel(job: { lastRun: { status: string } | null }): string {
  return job.lastRun ? job.lastRun.status : "—"
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
export function TriggersModal({ open, onOpenChange }: TriggersModalProps) {
  const sidebar = useSidebar()
  const queryClient = useQueryClient()
  const { data: jobs = [] } = useScheduledJobsQuery()
  const { runNow, rotateToken, setEnabled, deleteJob } = useScheduledJobActions()

  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deletingJob, setDeletingJob] = useState<ScheduledJob | null>(null)

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  )

  const handleSelect = (job: ScheduledJob) => {
    // Seed the detail-page query cache with the row we already have so the
    // job page renders immediately instead of showing the skeleton while it
    // re-fetches data we already had.
    queryClient.setQueryData(queryKeys.scheduledJobs.detail(job.id), job)
    sidebar.setActiveView({ type: "job", jobId: job.id, jobName: job.name })
    window.history.pushState(null, "", ROUTES.job.build(job.id))
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
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[80vh] flex flex-col bg-popover border border-border rounded-xl shadow-xl overflow-hidden"
          >
            <ModalHeader
              title={
                <>
                  <Clock className="h-4 w-4" />
                  Triggers
                </>
              }
            />

            <div className="flex-1 overflow-y-auto">
              {sortedJobs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No scheduled jobs found.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Trigger type</th>
                      <th className="px-4 py-2 font-medium">Next run</th>
                      <th className="px-4 py-2 font-medium">Enabled</th>
                      <th className="px-4 py-2 font-medium">Last run status</th>
                      <th className="px-4 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer"
                        onClick={() => handleSelect(job)}
                      >
                        <td className="px-4 py-2.5 truncate max-w-[14rem]">{job.name}</td>
                        <td className="px-4 py-2.5"><TriggerTypeCell job={job} /></td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {job.triggerType === "interval" ? format(job.nextRunAt, "MMM d, h:mm a") : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Switch
                            checked={job.enabled}
                            onCheckedChange={(enabled) => setEnabled(job, enabled)}
                            aria-label={job.enabled ? "Disable job" : "Enable job"}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {lastRunStatusLabel(job)}
                          {job.lastRun && (
                            <span className="ml-1.5 text-xs">({lastRunLabel(job)})</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => runNow(job)}
                              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              title="Run now"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                            <ScheduledJobActionsMenu
                              job={job}
                              onEdit={setEditingJob}
                              onRunNow={runNow}
                              onRotateToken={rotateToken}
                              onToggleEnabled={(j, enabled) => setEnabled(j, enabled)}
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
