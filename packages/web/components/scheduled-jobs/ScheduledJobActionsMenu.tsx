"use client"

import { MoreHorizontal, Play, Pencil, Trash2, KeyRound, Power } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"

interface ScheduledJobActionsMenuProps {
  job: ScheduledJob
  onEdit: (job: ScheduledJob) => void
  onRunNow: (job: ScheduledJob) => void
  onRotateToken?: (job: ScheduledJob) => void
  onToggleEnabled?: (job: ScheduledJob, enabled: boolean) => void
  onRequestDelete: (job: ScheduledJob) => void
  /** Stop the trigger click from bubbling to a row's onClick (row layouts only). */
  stopPropagation?: boolean
  className?: string
}

/**
 * Edit button + "..." overflow menu (Run Now / Enable-Disable / Rotate
 * Webhook Token / Delete) shared by the job detail page's header menu
 * (previously also JobsList's per-row menu, before the standalone jobs list
 * was removed), so the markup lives in exactly one place. Edit sits outside
 * the dropdown as its own button since it's the most common action.
 */
export function ScheduledJobActionsMenu({
  job,
  onEdit,
  onRunNow,
  onRotateToken,
  onToggleEnabled,
  onRequestDelete,
  stopPropagation,
  className,
}: ScheduledJobActionsMenuProps) {
  const stop = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation()
  }

  const buttonClassName = className ?? "p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => {
          stop(e)
          onEdit(job)
        }}
        className={buttonClassName}
        aria-label="Edit"
        title="Edit"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={stop}
            className={buttonClassName}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          <DropdownMenuItem onSelect={() => onRunNow(job)}>
            <Play className="h-3.5 w-3.5 mr-2" />
            Run Now
          </DropdownMenuItem>
          {onToggleEnabled && (
            <DropdownMenuItem onSelect={() => onToggleEnabled(job, !job.enabled)}>
              <Power className="h-3.5 w-3.5 mr-2" />
              {job.enabled ? "Disable" : "Enable"}
            </DropdownMenuItem>
          )}
          {job.triggerType === "incoming" && onRotateToken && (
            <DropdownMenuItem onSelect={() => onRotateToken(job)}>
              <KeyRound className="h-3.5 w-3.5 mr-2" />
              Rotate Webhook Token
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => onRequestDelete(job)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
