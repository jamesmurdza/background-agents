"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, Webhook } from "lucide-react"
import { format } from "date-fns"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { useScheduledJobsQuery } from "@/lib/query/hooks/useScheduledJobsQuery"
import { useScheduledJobActions } from "@/lib/hooks/useScheduledJobActions"
import { queryKeys } from "@/lib/query/keys"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"

interface SearchJobsPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Last run date, or blank if the job has never run. */
function lastRunLabel(job: { lastRun: { startedAt: number } | null }): string {
  return job.lastRun ? format(job.lastRun.startedAt, "MMM d, h:mm a") : ""
}

/** Icon reflecting how the job is triggered — a schedule vs. an incoming webhook. */
function TriggerIcon({ job }: { job: { triggerType: string } }) {
  return job.triggerType === "incoming" ? (
    <Webhook className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
  ) : (
    <Clock className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
  )
}

/**
 * Standalone "Agents" command palette — lists all scheduled jobs,
 * most-recently-updated first, and navigates to the job's detail page on
 * selection. Kept separate from SearchPalette (chats/repos/branches) since
 * scheduled jobs are a distinct entity with their own cache/query hook.
 */
export function SearchJobsPalette({ open, onOpenChange }: SearchJobsPaletteProps) {
  const router = useRouter()
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
    // re-fetches data we already had (the list and detail queries use
    // different cache keys, so without this it's a guaranteed network
    // round-trip on every click).
    queryClient.setQueryData(queryKeys.scheduledJobs.detail(job.id), job)
    router.push(`/jobs/${job.id}`)
    onOpenChange(false)
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Agents"
        description="Search for scheduled agents"
      >
        <CommandInput placeholder="Search agents..." />
        <CommandList>
          <CommandEmpty>No scheduled jobs found.</CommandEmpty>
          <CommandGroup
            heading={
              <div className="flex items-center">
                <span className="flex-1">Scheduled Jobs</span>
                <span className="ml-2 shrink-0">Last run</span>
                <span className="ml-1 shrink-0 w-5" />
              </div>
            }
          >
            {sortedJobs.map((job) => (
              <CommandItem
                key={job.id}
                value={`job:${job.name}:${job.repo}`}
                onSelect={() => handleSelect(job)}
              >
                <TriggerIcon job={job} />
                <span className="flex-1 truncate">{job.name}</span>
                <span className="text-muted-foreground text-xs ml-2 shrink-0">{lastRunLabel(job)}</span>
                <ScheduledJobActionsMenu
                  job={job}
                  onEdit={setEditingJob}
                  onRunNow={runNow}
                  onRotateToken={rotateToken}
                  onToggleEnabled={(j, enabled) => setEnabled(j, enabled)}
                  onRequestDelete={setDeletingJob}
                  stopPropagation
                  editInMenu
                  className="ml-1 shrink-0 p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

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
