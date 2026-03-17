"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Loader2, GitCommitHorizontal, GitBranch, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PATHS } from "@/lib/constants"
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet"

interface GitCommit {
  hash: string
  shortHash: string
  author: string
  email: string
  message: string
  timestamp: string
}

interface GitHistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sandboxId: string
  repoName: string
  baseBranch: string
  onScrollToCommit?: (shortHash: string) => void
  onBranchFromCommit?: (commitHash: string) => void
  refreshTrigger?: number
}

export function GitHistorySheet({
  open,
  onOpenChange,
  sandboxId,
  repoName,
  baseBranch,
  onScrollToCommit,
  onBranchFromCommit,
  refreshTrigger,
}: GitHistorySheetProps) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [mergeBase, setMergeBase] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "log",
          targetBranch: baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCommits(data.commits || [])
      setMergeBase(data.mergeBase || "")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [sandboxId, repoName, baseBranch])

  // Fetch when sheet opens
  useEffect(() => {
    if (open) {
      fetchLog()
    }
  }, [open, fetchLog])

  // Auto-refresh when refreshTrigger changes
  useEffect(() => {
    if (open && refreshTrigger && refreshTrigger > 0) {
      fetchLog()
    }
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  function formatDate(ts: string) {
    try {
      const d = new Date(ts)
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    } catch {
      return ts
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="Git History"
        className="w-[300px] max-w-[85vw] p-0 flex flex-col [&>button]:hidden"
        style={{
          paddingTop: 'var(--safe-area-inset-top)',
          paddingBottom: 'var(--safe-area-inset-bottom)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <span className="text-sm font-semibold text-foreground">Git History</span>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchLog}
              disabled={loading}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Commits list */}
        <div className="flex-1 overflow-y-auto">
          {loading && commits.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading commits...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <span className="text-sm text-red-400">{error}</span>
            </div>
          ) : commits.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <GitCommitHorizontal className="h-6 w-6" />
              <span className="text-sm">No commits yet</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {commits.map((commit, i) => {
                const isMergeBase = mergeBase && commit.hash === mergeBase
                const mergeBaseIdx = mergeBase ? commits.findIndex((c) => c.hash === mergeBase) : -1
                const isInherited = mergeBaseIdx >= 0 && i >= mergeBaseIdx
                return (
                  <div
                    key={commit.hash || i}
                    onClick={() => {
                      onScrollToCommit?.(commit.shortHash)
                      onOpenChange(false)
                    }}
                    className={cn(
                      "group/commit relative flex gap-3 border-b border-border/50 px-4 py-3 active:bg-accent/50",
                      isInherited && "opacity-40",
                      onScrollToCommit && "cursor-pointer"
                    )}
                  >
                    {/* Timeline dot */}
                    <div className="relative mt-1.5 flex flex-col items-center">
                      <div className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0",
                        isInherited ? "bg-muted-foreground/20" : "bg-muted-foreground/40"
                      )} />
                      {i < commits.length - 1 && (
                        <div className="absolute top-3.5 w-px flex-1 bg-border" style={{ height: "calc(100% + 8px)" }} />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm text-foreground leading-snug line-clamp-2">
                        {commit.message}
                      </span>
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary/70">{commit.shortHash}</code>
                        <span className="text-xs text-muted-foreground/60 truncate">{commit.author}</span>
                        {onBranchFromCommit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onBranchFromCommit(commit.hash)
                              onOpenChange(false)
                            }}
                            title="Branch from here"
                            className="ml-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary transition-colors"
                          >
                            <GitBranch className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground/40">{formatDate(commit.timestamp)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
