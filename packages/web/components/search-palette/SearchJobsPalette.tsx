"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { Clock, AlertCircle, Pause, Webhook } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { useScheduledJobsQuery } from "@/lib/query/hooks/useScheduledJobsQuery"
import { NEW_REPOSITORY } from "@/lib/types"

interface SearchJobsPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function jobStatusLabel(job: { enabled: boolean; triggerType: string; lastRun: { status: string } | null }): string {
  if (!job.enabled) return "Disabled"
  if (job.lastRun?.status === "error") return "Failing"
  return job.triggerType === "incoming" ? "Webhook" : "Enabled"
}

function JobStatusIcon({ job }: { job: { enabled: boolean; lastRun: { status: string } | null; triggerType: string } }) {
  if (!job.enabled) return <Pause className="mr-2 h-4 w-4 text-muted-foreground" />
  if (job.lastRun?.status === "error") return <AlertCircle className="mr-2 h-4 w-4 text-destructive" />
  if (job.triggerType === "incoming") return <Webhook className="mr-2 h-4 w-4 text-muted-foreground" />
  return <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
}

/**
 * Standalone "Search Jobs" command palette — lists all scheduled jobs,
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
      title="Search Jobs"
      description="Search for scheduled jobs"
    >
      <CommandInput placeholder="Search scheduled jobs..." />
      <CommandList>
        <CommandEmpty>No scheduled jobs found.</CommandEmpty>
        <CommandGroup heading="Scheduled Jobs">
          {sortedJobs.map((job) => (
            <CommandItem
              key={job.id}
              value={`job:${job.name}:${job.repo}`}
              onSelect={() => handleSelect(job.id)}
            >
              <JobStatusIcon job={job} />
              <span className="flex-1 truncate">{job.name}</span>
              {job.repo !== NEW_REPOSITORY && (
                <span className="text-muted-foreground text-xs ml-2 truncate">{job.repo}</span>
              )}
              <span className="text-muted-foreground text-xs ml-2 shrink-0">{jobStatusLabel(job)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
