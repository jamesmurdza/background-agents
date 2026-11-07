"use client"

import { MoreHorizontal, Play, Pencil, Trash2, KeyRound } from "lucide-react"
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
  onRequestDelete: (job: ScheduledJob) => void
  /** Stop the trigger click from bubbling to a row's onClick (row layouts only). */
  stopPropagation?: boolean
  className?: string
}

/**
 * The "..." overflow menu (Edit / Run Now / Rotate Webhook Token / Delete)
 * shared by the job detail page's header menu (previously also JobsList's
 * per-row menu, before the standalone jobs list was removed), so
 * the menu markup lives in exactly one place.
 */
export function ScheduledJobActionsMenu({
  job,
  onEdit,
  onRunNow,
  onRotateToken,
  onRequestDelete,
  stopPropagation,
  className,
}: ScheduledJobActionsMenuProps) {
  const stop = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={stop}
          className={className ?? "p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        <DropdownMenuItem onSelect={() => onEdit(job)}>
          <Pencil className="h-3.5 w-3.5 mr-2" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRunNow(job)}>
          <Play className="h-3.5 w-3.5 mr-2" />
          Run Now
        </DropdownMenuItem>
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
  )
}
