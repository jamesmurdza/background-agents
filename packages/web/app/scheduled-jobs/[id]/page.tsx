"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { ArrowLeft, Clock, ChevronDown, Check, X, AlertCircle, ExternalLink } from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { MessageBubble } from "@/components/MessageBubble"
import type { Message } from "@/lib/types"

// =============================================================================
// Types
// =============================================================================

interface ScheduledJob {
  id: string
  name: string
  prompt: string
  repo: string
  baseBranch: string
  agent: string
  model: string | null
  intervalMinutes: number
  enabled: boolean
  nextRunAt: number
  autoPR: boolean
  consecutiveFailures: number
  createdAt: number
  updatedAt: number
  lastRun: {
    id: string
    status: string
    startedAt: number
    completedAt: number | null
    prUrl: string | null
    prNumber: number | null
    error: string | null
  } | null
}

interface ScheduledJobRun {
  id: string
  status: string
  startedAt: number
  completedAt: number | null
  branch: string | null
  commitCount: number
  prUrl: string | null
  prNumber: number | null
  error: string | null
  chatId: string | null
}

// =============================================================================
// Helpers
// =============================================================================

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5 text-green-500" />
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
    case "running":
      return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function formatRunLabel(run: ScheduledJobRun): string {
  const date = format(run.startedAt, "MMM d, h:mm a")
  if (run.status === "completed" && run.prUrl) {
    return `${date} - PR #${run.prNumber}`
  }
  if (run.status === "completed") {
    return `${date} - No changes`
  }
  if (run.status === "error") {
    return `${date} - Failed`
  }
  if (run.status === "running") {
    return `${date} - Running`
  }
  return date
}

// =============================================================================
// Component
// =============================================================================

export default function ScheduledJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()

  const [job, setJob] = useState<ScheduledJob | null>(null)
  const [runs, setRuns] = useState<ScheduledJobRun[]>([])
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRun | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Fetch job and runs
  useEffect(() => {
    if (!session) return

    const fetchData = async () => {
      try {
        // Fetch job
        const jobRes = await fetch(`/api/scheduled-jobs/${id}`)
        if (!jobRes.ok) throw new Error("Failed to fetch job")
        const jobData = await jobRes.json()
        setJob(jobData)

        // Fetch runs
        const runsRes = await fetch(`/api/scheduled-jobs/${id}/runs`)
        if (!runsRes.ok) throw new Error("Failed to fetch runs")
        const runsData = await runsRes.json()
        setRuns(runsData.runs)

        // Select latest run by default
        if (runsData.runs.length > 0) {
          setSelectedRun(runsData.runs[0])
        }

        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [session, id])

  // Fetch messages when selected run changes
  useEffect(() => {
    if (!selectedRun?.chatId) {
      setMessages([])
      return
    }

    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/chats/${selectedRun.chatId}/messages`)
        if (!res.ok) throw new Error("Failed to fetch messages")
        const data = await res.json()
        setMessages(data.messages || [])
      } catch (err) {
        console.error("Failed to fetch messages:", err)
        setMessages([])
      }
    }

    fetchMessages()
    // Poll for updates if running
    if (selectedRun.status === "running") {
      const interval = setInterval(fetchMessages, 5000)
      return () => clearInterval(interval)
    }
  }, [selectedRun?.chatId, selectedRun?.status])

  // Render
  if (authStatus === "loading" || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Sign in required</h1>
          <p className="text-muted-foreground">Please sign in to view scheduled jobs</p>
        </div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Error</h1>
          <p className="text-muted-foreground">{error || "Job not found"}</p>
          <button
            onClick={() => router.push("/scheduled-jobs")}
            className="mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Back to Scheduled Jobs
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/scheduled-jobs")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{job.name}</h1>
            <p className="text-sm text-muted-foreground">{job.repo}</p>
          </div>
        </div>

        {/* Run selector dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors"
          >
            {selectedRun ? (
              <>
                {getStatusIcon(selectedRun.status)}
                <span className="text-sm">{formatRunLabel(selectedRun)}</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No runs yet</span>
            )}
            <ChevronDown className={cn("h-4 w-4 transition-transform", dropdownOpen && "rotate-180")} />
          </button>

          {dropdownOpen && runs.length > 0 && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => {
                      setSelectedRun(run)
                      setDropdownOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left",
                      run.id === selectedRun?.id && "bg-accent"
                    )}
                  >
                    {getStatusIcon(run.status)}
                    <span className="flex-1">{formatRunLabel(run)}</span>
                    {run.id === selectedRun?.id && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {selectedRun ? (
          <div className="max-w-4xl mx-auto p-6">
            {/* Run info */}
            <div className="mb-6 flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                Started {formatDistanceToNow(selectedRun.startedAt, { addSuffix: true })}
              </span>
              {selectedRun.completedAt && (
                <span>
                  Completed {formatDistanceToNow(selectedRun.completedAt, { addSuffix: true })}
                </span>
              )}
              {selectedRun.commitCount > 0 && (
                <span>{selectedRun.commitCount} commit{selectedRun.commitCount !== 1 ? "s" : ""}</span>
              )}
              {selectedRun.prUrl && (
                <a
                  href={selectedRun.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  PR #{selectedRun.prNumber}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Error display */}
            {selectedRun.error && (
              <div className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <div className="font-medium mb-1">Run failed</div>
                <div className="whitespace-pre-wrap">{selectedRun.error}</div>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {selectedRun.status === "running" ? (
                    <div className="flex items-center justify-center gap-2">
                      <Clock className="h-4 w-4 animate-pulse" />
                      Agent is running...
                    </div>
                  ) : (
                    "No messages for this run"
                  )}
                </div>
              ) : (
                messages.map((message, index) => (
                  <MessageBubble
                    key={message.id || index}
                    message={message}
                    isStreaming={selectedRun.status === "running" && index === messages.length - 1}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-medium mb-2">No runs yet</h2>
            <p className="text-muted-foreground">
              This job will run {formatDistanceToNow(job.nextRunAt, { addSuffix: true })}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
