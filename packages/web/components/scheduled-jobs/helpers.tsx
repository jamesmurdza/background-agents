import { CheckCircle2, XCircle, Circle, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import { type ScheduledJobRun } from "@/lib/scheduled-jobs/types"

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

export function formatRunLabel(run: ScheduledJobRun): string {
  return format(run.startedAt, "MMM d, h:mm a")
}
