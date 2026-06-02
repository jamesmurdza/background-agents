"use client"

import { useState } from "react"
import { MoreHorizontal, Play, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { getJobStatusIcon, getLastRunText, getTriggerDescription, getRepoLabel } from "./helpers"

interface JobsListProps {
  jobs: ScheduledJob[]
  onSelect: (jobId: string, jobName: string) => void
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onRequestDelete: (job: ScheduledJob) => void
}

/**
 * Per-row actions dropdown (Edit / Run Now / Delete). Shared by both the mobile
 * card and desktop table layouts so the menu markup lives in exactly one place.
 */
function JobRowMenu({
  job,
  open,
  onToggle,
  onEdit,
  onRunNow,
  onRequestDelete,
}: {
  job: ScheduledJob
  open: boolean
  onToggle: () => void
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onRequestDelete: (job: ScheduledJob) => void
}) {
  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-popover py-1 shadow-lg">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit(job)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRunNow(job)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Play className="h-3.5 w-3.5" />
              Run Now
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggle()
                onRequestDelete(job)
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
  )
}

export function JobsList({ jobs, onSelect, onEdit, onRunNow, onRequestDelete }: JobsListProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const renderMenu = (job: ScheduledJob) => (
    <JobRowMenu
      job={job}
      open={menuOpenId === job.id}
      onToggle={() => setMenuOpenId(menuOpenId === job.id ? null : job.id)}
      onEdit={(j) => {
        setMenuOpenId(null)
        onEdit(j)
      }}
      onRunNow={(j) => {
        setMenuOpenId(null)
        onRunNow(j)
      }}
      onRequestDelete={onRequestDelete}
    />
  )

  return (
    <>
      {/* Mobile Card Layout */}
      <div className="space-y-3 md:hidden">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="rounded-lg border border-border bg-white/50 dark:bg-white/5 p-4 cursor-pointer"
            onClick={() => onSelect(job.id, job.name)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {getJobStatusIcon(job)}
                <span className={cn(
                  "text-sm font-medium truncate",
                  !job.enabled && "text-muted-foreground"
                )}>
                  {job.name}
                </span>
                {!job.enabled && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                    Disabled
                  </span>
                )}
              </div>
              <div className="shrink-0">{renderMenu(job)}</div>
            </div>
            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <div className={cn("truncate", job.repo === NEW_REPOSITORY && "italic")}>{getRepoLabel(job.repo)}</div>
              <div className="flex items-center justify-between gap-2">
                <span>{getTriggerDescription(job)}</span>
                <span className={cn(
                  job.lastRun?.status === "error" && "text-destructive"
                )}>
                  {getLastRunText(job)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table Layout */}
      <div className="hidden md:block rounded-lg border border-border bg-background">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Repository</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Schedule</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Last run</th>
              <th className="px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="bg-white/50 dark:bg-white/5 cursor-pointer"
                onClick={() => onSelect(job.id, job.name)}
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
                <td className={cn(
                  "px-4 py-3 text-sm text-muted-foreground",
                  job.repo === NEW_REPOSITORY && "italic"
                )}>
                  {getRepoLabel(job.repo)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {getTriggerDescription(job)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  <span className={cn(
                    job.lastRun?.status === "error" && "text-destructive"
                  )}>
                    {getLastRunText(job)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{renderMenu(job)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
