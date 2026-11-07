"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { AlarmClock } from "lucide-react"
import { format } from "date-fns"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { useScheduledJobsQuery } from "@/lib/query/hooks/useScheduledJobsQuery"

interface SearchJobsPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Last run date, or blank if the job has never run. */
function lastRunLabel(job: { lastRun: { startedAt: number } | null }): string {
  return job.lastRun ? format(job.lastRun.startedAt, "MMM d, h:mm a") : ""
}

/**
 * Standalone "Triggers" command palette — lists all scheduled jobs,
 * most-recently-updated first, and navigates to the job's detail page on
 * selection. Kept separate from SearchPalette (chats/repos/branches) since
 * scheduled jobs are a distinct entity with their own cache/query hook.
 */
export function SearchJobsPalette({ open, onOpenChange }: SearchJobsPaletteProps) {
  const router = useRouter()
  const { data: jobs = [] } = useScheduledJobsQuery()

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  )

  const handleSelect = (jobId: string) => {
    router.push(`/jobs/${jobId}`)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Triggers"
      description="Search for scheduled triggers"
    >
      <CommandInput placeholder="Search triggers..." />
      <CommandList>
        <CommandEmpty>No scheduled jobs found.</CommandEmpty>
        <CommandGroup heading="Scheduled Jobs">
          {sortedJobs.map((job) => (
            <CommandItem
              key={job.id}
              value={`job:${job.name}:${job.repo}`}
              onSelect={() => handleSelect(job.id)}
            >
              <AlarmClock className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{job.name}</span>
              <span className="text-muted-foreground text-xs ml-2 shrink-0">{lastRunLabel(job)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
