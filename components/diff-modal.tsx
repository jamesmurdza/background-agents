"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
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
import type { Settings } from "@/lib/types"

interface DiffModalProps {
  open: boolean
  onClose: () => void
  sandboxId: string
  repoName: string
  branchName: string
  baseBranch: string
  settings: Settings
}

export function DiffModal({ open, onClose, sandboxId, repoName, branchName, baseBranch, settings }: DiffModalProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [compareBranch, setCompareBranch] = useState(baseBranch)
  const [diff, setDiff] = useState("")
  const [loading, setLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "list-branches",
        }),
      })
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
  }, [sandboxId, repoName, branchName, baseBranch, settings.daytonaApiKey, compareBranch])

  const fetchDiff = useCallback(async () => {
    if (!compareBranch) return
    setLoading(true)
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "diff",
          targetBranch: `origin/${compareBranch}`,
        }),
      })
      const data = await res.json()
      setDiff(data.diff || "No differences found.")
    } catch {
      setDiff("Failed to load diff.")
    } finally {
      setLoading(false)
    }
  }, [sandboxId, repoName, compareBranch, settings.daytonaApiKey])

  useEffect(() => {
    if (open) {
      fetchBranches()
    }
  }, [open, fetchBranches])

  useEffect(() => {
    if (open && compareBranch) {
      fetchDiff()
    }
  }, [open, compareBranch, fetchDiff])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle className="text-sm">Diff</DialogTitle>
            {branchesLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Select value={compareBranch} onValueChange={setCompareBranch}>
                <SelectTrigger className="w-48 h-7 text-xs">
                  <SelectValue placeholder="Compare to..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">...{branchName}</span>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded border border-border bg-background">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <pre className="p-3 text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto">
              {diff.split("\n").map((line, i) => {
                let cls = "text-muted-foreground"
                if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-green-400"
                else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400"
                else if (line.startsWith("@@")) cls = "text-blue-400"
                else if (line.startsWith("diff ")) cls = "text-foreground font-semibold"
                return (
                  <div key={i} className={cls}>
                    {line}
                  </div>
                )
              })}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
