"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch, Settings } from "@/lib/types"
import { agentLabels } from "@/lib/types"
import { generateId } from "@/lib/store"
import { GitBranch, Plus, Search, ChevronDown, Loader2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

const WORDS = [
  "swift","lunar","amber","coral","ember","frost","bloom","spark","drift","pulse",
  "cedar","maple","river","stone","cloud","flame","steel","light","storm","wave",
  "tiger","eagle","brave","vivid","noble","rapid","quiet","sharp","fresh","grand",
]

function randomBranchName() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]
  return `${pick()}-${pick()}-${pick()}`
}

interface BranchListProps {
  repo: Repo
  activeBranchId: string | null
  onSelectBranch: (branchId: string) => void
  onAddBranch: (branch: Branch) => void
  onRemoveBranch: (branchId: string) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  settings: Settings
  width: number
  onWidthChange: (w: number) => void
  pendingStartCommit?: string | null
  onClearPendingCommit?: () => void
}

function StatusDot({ branch, isActive }: { branch: Branch; isActive: boolean }) {
  if (branch.status === "running" || branch.status === "creating") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </span>
    )
  }

  if (branch.status === "error") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-red-400" />
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

export function BranchList({
  repo,
  activeBranchId,
  onSelectBranch,
  onAddBranch,
  onRemoveBranch,
  onUpdateBranch,
  settings,
  width,
  onWidthChange,
  pendingStartCommit,
  onClearPendingCommit,
}: BranchListProps) {
  const [search, setSearch] = useState("")
  const [branchFromOpen, setBranchFromOpen] = useState(false)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [branchPlaceholder, setBranchPlaceholder] = useState(() => randomBranchName())
  const [newBranchBase, setNewBranchBase] = useState(
    (activeBranchId && repo.branches.find((b) => b.id === activeBranchId)?.name) || repo.defaultBranch || "main"
  )
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [startCommit, setStartCommit] = useState<string | null>(null)
  const isResizing = useRef(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const newBranchInputRef = useRef<HTMLInputElement>(null)

  const filtered = repo.branches
    .filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.lastActivityTs ?? 0) - (a.lastActivityTs ?? 0))

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

  useEffect(() => {
    if (newBranchOpen && newBranchInputRef.current) {
      newBranchInputRef.current.focus()
    }
  }, [newBranchOpen])

  // Open new branch dialog when a commit is selected from git history
  useEffect(() => {
    if (pendingStartCommit) {
      setNewBranchOpen(true)
      setBranchPlaceholder(randomBranchName())
      setStartCommit(pendingStartCommit)
      onClearPendingCommit?.()
    }
  }, [pendingStartCommit, onClearPendingCommit])

  const [deleteModalBranchId, setDeleteModalBranchId] = useState<string | null>(null)
  const deleteModalBranch = deleteModalBranchId ? repo.branches.find((b) => b.id === deleteModalBranchId) : null

  function startResize() {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const handleCreateBranch = useCallback(async () => {
    const branchName = newBranchName.trim() || branchPlaceholder
    if (!branchName || creating) return

    // Validate branch name
    if (/\s/.test(branchName)) {
      setCreateError("Branch name cannot contain spaces")
      return
    }
    if (/[~^:?*\[\\]/.test(branchName)) {
      setCreateError("Branch name contains invalid characters")
      return
    }
    if (branchName.startsWith("-") || branchName.startsWith(".") || branchName.endsWith(".") || branchName.endsWith(".lock")) {
      setCreateError("Invalid branch name format")
      return
    }
    if (branchName.includes("..") || branchName.includes("@{")) {
      setCreateError("Branch name contains invalid sequence")
      return
    }
    // Check for duplicates
    if (repo.branches.some((b) => b.name === branchName)) {
      setCreateError("A branch with this name already exists")
      return
    }

    if (!settings.daytonaApiKey || !settings.anthropicApiKey || !settings.githubPat) {
      setCreateError("Please configure API keys in Settings first")
      return
    }

    setCreating(true)
    setCreateError(null)

    const branchId = generateId()
    const branch: Branch = {
      id: branchId,
      name: branchName,
      agent: "claude-code",
      messages: [],
      status: "creating",
      lastActivity: "now",
      lastActivityTs: Date.now(),
      baseBranch: newBranchBase,
    }

    onAddBranch(branch)
    setNewBranchOpen(false)
    setNewBranchName("")
    setStartCommit(null)

    try {
      const res = await fetch("/api/sandbox/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          anthropicApiKey: settings.anthropicApiKey,
          githubPat: settings.githubPat,
          repoOwner: repo.owner,
          repoName: repo.name,
          baseBranch: newBranchBase,
          newBranch: branchName,
          ...(startCommit ? { startCommit } : {}),
        }),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop()!

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === "done") {
                onUpdateBranch(branchId, {
                  status: "idle",
                  sandboxId: data.sandboxId,
                  contextId: data.contextId,
                  previewUrlPattern: data.previewUrlPattern,
                })
              } else if (data.type === "error") {
                onUpdateBranch(branchId, {
                  status: "error",
                })
                setCreateError(data.message)
              }
            } catch {}
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create branch"
      onUpdateBranch(branchId, { status: "error" })
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }, [newBranchName, newBranchBase, creating, settings, repo, onAddBranch, onUpdateBranch])

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
        {filtered.length === 0 && repo.branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <GitBranch className="h-5 w-5" />
            <p className="text-xs text-center">Create a new branch to start working with an agent</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((branch) => {
              const isActive = branch.id === activeBranchId
              const isBold = branch.status === "running" || branch.status === "creating" || (branch.unread && !isActive)
              return (
                <div key={branch.id} className="group relative">
                  <button
                    onClick={() => onSelectBranch(branch.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors",
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
                          {branch.status === "creating" ? "Setting up..." : agentLabels[branch.agent]}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60">
                          {branch.lastActivity}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteModalBranchId(branch.id)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-all hover:bg-destructive/20 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* New Branch Section */}
      {newBranchOpen ? (
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">New branch</span>
              <button
                onClick={() => {
                  setNewBranchOpen(false)
                  setCreateError(null)
                }}
                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <Input
              ref={newBranchInputRef}
              placeholder={branchPlaceholder}
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateBranch()
                if (e.key === "Escape") {
                  setNewBranchOpen(false)
                  setCreateError(null)
                }
              }}
              className="h-8 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
              disabled={creating}
            />
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>from</span>
              {startCommit ? (
                <div className="flex items-center gap-1.5">
                  <code className="bg-secondary rounded px-1.5 py-0.5 text-[11px] font-mono text-primary/70 border border-border">
                    {startCommit.slice(0, 7)}
                  </code>
                  <button
                    onClick={() => setStartCommit(null)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <select
                  value={newBranchBase}
                  onChange={(e) => setNewBranchBase(e.target.value)}
                  className="bg-secondary rounded px-1.5 py-0.5 text-[11px] text-foreground border border-border"
                  disabled={creating}
                >
                  <option value={repo.defaultBranch || "main"}>{repo.defaultBranch || "main"}</option>
                  {repo.branches.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
            {createError && (
              <p className="text-[11px] text-red-400">{createError}</p>
            )}
            <button
              onClick={handleCreateBranch}
              disabled={creating}
              className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {creating && <Loader2 className="h-3 w-3 animate-spin" />}
              Create branch
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-3">
          <button
            onClick={() => {
              setNewBranchOpen(true)
              setBranchPlaceholder(randomBranchName())
              setNewBranchBase(
                (activeBranchId && repo.branches.find((b) => b.id === activeBranchId)?.name) || repo.defaultBranch || "main"
              )
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">New branch</span>
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      <Dialog open={!!deleteModalBranchId} onOpenChange={(open) => { if (!open) setDeleteModalBranchId(null) }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove branch</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Are you sure you want to remove <span className="font-semibold text-foreground">{deleteModalBranch?.name}</span>? This will delete the chat history and sandbox.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeleteModalBranchId(null)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (deleteModalBranchId) {
                  onRemoveBranch(deleteModalBranchId)
                  setDeleteModalBranchId(null)
                }
              }}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 cursor-pointer"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
      />
    </div>
  )
}
