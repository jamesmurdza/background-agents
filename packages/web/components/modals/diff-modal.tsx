"use client"

import { useState, useEffect, useCallback, Fragment } from "react"
import { cn } from "@/lib/shared/utils"
import { Loader2, FileText } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// --- Diff parser types ---

interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header"
  content: string
  oldLine?: number
  newLine?: number
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface DiffFile {
  path: string
  hunks: DiffHunk[]
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  // Split on "diff --git" boundaries
  const fileSections = raw.split(/^diff --git /m).filter(Boolean)

  for (const section of fileSections) {
    const lines = section.split("\n")
    // Extract filename from +++ b/... line
    let path = ""
    let headerEnd = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("+++ b/")) {
        path = lines[i].slice(6)
        headerEnd = i + 1
        break
      }
      if (lines[i].startsWith("+++ /dev/null")) {
        // File was deleted — use --- a/... line
        for (let j = 0; j < i; j++) {
          if (lines[j].startsWith("--- a/")) {
            path = lines[j].slice(6) + " (deleted)"
            break
          }
        }
        headerEnd = i + 1
        break
      }
    }
    if (!path) continue

    const hunks: DiffHunk[] = []
    let currentHunk: DiffHunk | null = null
    let oldLine = 0
    let newLine = 0

    for (let i = headerEnd; i < lines.length; i++) {
      const line = lines[i]
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/)
      if (hunkMatch) {
        currentHunk = {
          header: line,
          lines: [{ type: "hunk-header", content: line }],
        }
        hunks.push(currentHunk)
        oldLine = parseInt(hunkMatch[1], 10)
        newLine = parseInt(hunkMatch[2], 10)
        continue
      }
      if (!currentHunk) continue

      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "add", content: line.slice(1), newLine: newLine++ })
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "del", content: line.slice(1), oldLine: oldLine++ })
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" — skip
      } else {
        currentHunk.lines.push({ type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
      }
    }

    files.push({ path, hunks })
  }

  return files
}

// --- Component ---

interface DiffModalProps {
  open: boolean
  onClose: () => void
  repoOwner: string
  repoName: string
  branchName: string
  baseBranch: string
  startCommit?: string | null
  commitHash?: string | null
  commitMessage?: string | null
}

type DiffMode = "since-created" | "vs-branch"

export function DiffModal({ open, onClose, repoOwner, repoName, branchName, baseBranch, startCommit, commitHash, commitMessage }: DiffModalProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [compareBranch, setCompareBranch] = useState(baseBranch)
  const [diff, setDiff] = useState("")
  const [loading, setLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [diffMode, setDiffMode] = useState<DiffMode>(startCommit ? "since-created" : "vs-branch")

  const isCommitMode = !!commitHash

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`
      )
      const data = await res.json()
      const brList = (data.branches || []).filter((b: string) => b !== branchName)
      setBranches(brList)
      if (!compareBranch && brList.includes(baseBranch)) {
        setCompareBranch(baseBranch)
      }
    } catch {
      setBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoName, branchName, baseBranch, compareBranch])

  const fetchDiff = useCallback(async () => {
    const base = diffMode === "since-created" && startCommit
      ? startCommit
      : compareBranch
    if (!base) return
    setLoading(true)
    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoName,
          base,
          head: branchName,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDiff(data.error || "No differences found.")
      } else {
        setDiff(data.diff || "No differences found.")
      }
    } catch {
      setDiff("Failed to load diff.")
    } finally {
      setLoading(false)
    }
  }, [repoOwner, repoName, branchName, baseBranch, startCommit, compareBranch, diffMode])

  const fetchCommitDiff = useCallback(async () => {
    if (!commitHash) return
    setLoading(true)
    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoName,
          commitHash,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Handle expected errors gracefully (commit not found, etc.)
        setDiff(data.error || "No differences found.")
      } else {
        setDiff(data.diff || "No differences found.")
      }
    } catch {
      setDiff("Failed to load diff.")
    } finally {
      setLoading(false)
    }
  }, [repoOwner, repoName, commitHash])

  useEffect(() => {
    if (open && !isCommitMode && diffMode === "vs-branch") {
      fetchBranches()
    }
  }, [open, isCommitMode, diffMode, fetchBranches])

  useEffect(() => {
    if (open && !isCommitMode) {
      if (diffMode === "vs-branch" && !compareBranch) return
      fetchDiff()
    }
  }, [open, isCommitMode, diffMode, compareBranch, fetchDiff])

  useEffect(() => {
    if (open && isCommitMode) {
      fetchCommitDiff()
    }
  }, [open, isCommitMode, fetchCommitDiff])

  const parsedFiles = parseDiff(diff)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <DialogTitle className="text-sm">Diff</DialogTitle>
            {isCommitMode ? (
              <>
                <code className="rounded bg-accent px-1.5 py-0.5 text-xs font-mono text-primary/70">{commitHash}</code>
                {commitMessage && <span className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-[300px]">{commitMessage}</span>}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  {startCommit && (
                    <button
                      onClick={() => setDiffMode("since-created")}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs cursor-pointer transition-colors",
                        diffMode === "since-created"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Since created
                    </button>
                  )}
                  <button
                    onClick={() => setDiffMode("vs-branch")}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs cursor-pointer transition-colors",
                      diffMode === "vs-branch"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Compare
                  </button>
                </div>
                {diffMode === "vs-branch" && (
                  branchesLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Select value={compareBranch} onValueChange={setCompareBranch}>
                      <SelectTrigger className="w-36 sm:w-48 h-7 text-xs">
                        <SelectValue placeholder="Compare to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                )}
                <span className="text-xs text-muted-foreground truncate">...{branchName}</span>
              </>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded border border-border bg-background">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : parsedFiles.length > 0 ? (
            <div className="divide-y divide-border">
              {parsedFiles.map((file, fi) => (
                <div key={fi}>
                  {/* File header */}
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-accent/50 px-3 py-1.5 border-b border-border">
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs font-mono font-medium text-foreground truncate">{file.path}</span>
                  </div>
                  {/* Hunks */}
                  {file.hunks.map((hunk, hi) => (
                    <table key={hi} className="w-full border-collapse font-mono text-xs">
                      <tbody>
                        {hunk.lines.map((line, li) => {
                          if (line.type === "hunk-header") {
                            return (
                              <tr key={li} className="bg-blue-500/10">
                                <td colSpan={3} className="px-3 py-1 text-blue-400 text-[11px]">
                                  {line.content}
                                </td>
                              </tr>
                            )
                          }
                          const bgClass =
                            line.type === "add"
                              ? "bg-green-500/10"
                              : line.type === "del"
                              ? "bg-red-500/10"
                              : ""
                          const textClass =
                            line.type === "add"
                              ? "text-green-400"
                              : line.type === "del"
                              ? "text-red-400"
                              : "text-muted-foreground"
                          const prefix =
                            line.type === "add" ? "+" : line.type === "del" ? "-" : " "
                          return (
                            <tr key={li} className={bgClass}>
                              <td className="w-[1px] whitespace-nowrap select-none border-r border-border/50 px-2 py-0 text-right text-[10px] text-muted-foreground/40">
                                {line.oldLine ?? ""}
                              </td>
                              <td className="w-[1px] whitespace-nowrap select-none border-r border-border/50 px-2 py-0 text-right text-[10px] text-muted-foreground/40">
                                {line.newLine ?? ""}
                              </td>
                              <td className={`px-3 py-0 whitespace-pre ${textClass}`}>
                                <span className="select-none">{prefix}</span>
                                {line.content}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <pre className="p-3 text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto text-muted-foreground">
              {diff}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
