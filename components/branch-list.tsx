"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch } from "@/lib/mock-data"
import { agentLabels } from "@/lib/mock-data"
import { GitBranch, Plus, Search, ChevronDown, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState, useRef, useEffect } from "react"

interface BranchListProps {
  repo: Repo
  activeBranchId: string | null
  onSelectBranch: (branchId: string) => void
  width: number
  onWidthChange: (w: number) => void
}

function StatusDot({ branch, isActive }: { branch: Branch; isActive: boolean }) {
  if (branch.status === "running") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </span>
    )
  }

  if (branch.unread && !isActive) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-foreground" />
      </span>
    )
  }

  return <span className="h-4 w-4 shrink-0" />
}

export function BranchList({ repo, activeBranchId, onSelectBranch, width, onWidthChange }: BranchListProps) {
  const [search, setSearch] = useState("")
  const [branchFromOpen, setBranchFromOpen] = useState(false)
  const isResizing = useRef(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = repo.branches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  )

  const activeBranch = activeBranchId
    ? repo.branches.find((b) => b.id === activeBranchId)
    : null

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const newWidth = Math.min(Math.max(e.clientX - 60, 200), 500)
      onWidthChange(newWidth)
    }
    function onMouseUp() {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [onWidthChange])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBranchFromOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function startResize() {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  return (
    <div className="relative flex h-full shrink-0 flex-col border-r border-border bg-card" style={{ width }}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
          <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
        </svg>
        <span className="text-sm font-semibold text-foreground truncate">
          {repo.owner}/{repo.name}
        </span>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search branches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 bg-secondary border-none pl-8 text-xs placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {filtered.map((branch) => {
            const isActive = branch.id === activeBranchId
            const isBold = branch.status === "running" || (branch.unread && !isActive)
            return (
              <button
                key={branch.id}
                onClick={() => onSelectBranch(branch.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <StatusDot branch={branch} isActive={isActive} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn(
                      "truncate text-sm",
                      isBold ? "font-semibold text-foreground" : "font-medium"
                    )}>
                      {branch.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-5.5">
                    <span className="text-[11px] text-muted-foreground">
                      {agentLabels[branch.agent]}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60">
                      {branch.lastActivity}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-0.5">
          <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md rounded-r-none bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground overflow-hidden">
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {activeBranch ? <>New from <span className="font-mono text-foreground/70">{activeBranch.name}</span></> : "New branch"}
            </span>
          </button>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setBranchFromOpen(!branchFromOpen)}
              className="flex cursor-pointer h-full items-center justify-center rounded-md rounded-l-none bg-secondary px-1.5 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground border-l border-border"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {branchFromOpen && (
              <div className="absolute bottom-full right-0 mb-1 z-50 flex flex-col rounded-lg border border-border bg-popover py-1 shadow-lg min-w-[160px]">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">Branch from</div>
                {repo.branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBranchFromOpen(false)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent text-left",
                      b.id === activeBranchId ? "text-primary" : "text-foreground"
                    )}
                  >
                    <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{b.name}</span>
                  </button>
                ))}
                <div className="mx-2 my-1 h-px bg-border" />
                <button
                  onClick={() => setBranchFromOpen(false)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent text-left text-foreground"
                >
                  <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">main</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
      />
    </div>
  )
}
