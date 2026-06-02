import { Clock, AlertCircle, Check, X, CheckCircle2, XCircle, Circle, RefreshCw } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import { type ScheduledJob, type ScheduledJobRun } from "@/lib/scheduled-jobs/types"
import { NEW_REPOSITORY } from "@/lib/types"

export function getRepoLabel(repo: string): string {
  return repo === NEW_REPOSITORY ? "No repository" : repo
}

export function getJobStatusIcon(job: ScheduledJob) {
  if (!job.enabled) {
    return <X className="h-3.5 w-3.5 text-muted-foreground" />
  }
  if (job.lastRun?.status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
  if (job.lastRun?.status === "completed") {
    return <Check className="h-3.5 w-3.5 text-green-500" />
  }
  if (job.lastRun?.status === "running") {
    return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
}

export function getRunStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    case "running":
      return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

export function getLastRunText(job: ScheduledJob): string {
  if (!job.lastRun) return "Never run"

  const timeAgo = formatDistanceToNow(job.lastRun.startedAt, { addSuffix: true })

  if (job.lastRun.status === "running") {
    return `Running ${timeAgo}`
  }
  if (job.lastRun.status === "error") {
    return `Failed ${timeAgo}`
  }
  if (job.lastRun.prUrl) {
    return `PR #${job.lastRun.prNumber} ${timeAgo}`
  }
  if (job.lastRun.status === "completed") {
    return `No changes ${timeAgo}`
  }
  return timeAgo
}

export function formatRunLabel(run: ScheduledJobRun): string {
  return format(run.startedAt, "MMM d, h:mm a")
}

export function formatDuration(startedAt: number, completedAt: number): string {
  const durationMs = completedAt - startedAt
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export function getTriggerDescription(job: ScheduledJob): string {
  if (job.triggerType === "incoming") {
    return "Webhook"
  }
  // Interval trigger - show human-readable schedule
  const minutes = job.intervalMinutes
  if (minutes < 60) {
    return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  const hours = Math.round(minutes / 60)
  if (minutes < 1440) {
    return `Every ${hours} hour${hours === 1 ? "" : "s"}`
  }
  const days = Math.round(minutes / 1440)
  return `Every ${days} day${days === 1 ? "" : "s"}`
}
