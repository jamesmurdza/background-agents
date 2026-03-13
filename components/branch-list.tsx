"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch } from "@/lib/types"
import { agentLabels } from "@/lib/types"
import { generateId } from "@/lib/store"
import { randomBranchName, validateBranchName } from "@/lib/branch-utils"
import { BRANCH_STATUS } from "@/lib/constants"
import { StatusDot } from "@/components/ui/status-dot"
import { DeleteBranchDialog, useDeleteBranchDialog } from "@/components/delete-branch-dialog"
import { GitBranch, Plus, Search, ChevronDown, Loader2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState, useRef, useEffect, useCallback } from "react"

interface BranchListProps {
  repo: Repo
  activeBranchId: string | null
  onSelectBranch: (branchId: string) => void
  onAddBranch: (branch: Branch) => void
  onRemoveBranch: (branchId: string, deleteRemote?: boolean) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  onQuotaRefresh?: () => void
  quota?: { current: number; max: number; remaining: number } | null
  width: number | string
  onWidthChange: (w: number) => void
  pendingStartCommit?: string | null
  onClearPendingCommit?: () => void
  isMobile?: boolean
}

export function BranchList({
  repo,
  activeBranchId,
  onSelectBranch,
  onAddBranch,
  onRemoveBranch,
  onUpdateBranch,
  onQuotaRefresh,
  quota,
  width,
  onWidthChange,
  pendingStartCommit,
  onClearPendingCommit,
  isMobile = false,
}: BranchListProps) {
  const [search, setSearch] = useState("")
  const [branchFromOpen, setBranchFromOpen] = useState(false)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [branchPlaceholder, setBranchPlaceholder] = useState(() => randomBranchName())
  const [newBranchBase, setNewBranchBase] = useState(repo.defaultBranch || "main")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [startCommit, setStartCommit] = useState<string | null>(null)
  const [githubBranches, setGithubBranches] = useState<string[]>([])
  const [githubBranchesLoading, setGithubBranchesLoading] = useState(false)
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

  const fetchGithubBranches = useCallback(async () => {
    setGithubBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}`
      )
      const data = await res.json()
      setGithubBranches(data.branches || [])
    } catch {
      setGithubBranches([])
    } finally {
      setGithubBranchesLoading(false)
    }
  }, [repo.owner, repo.name])

  // Open new branch dialog when a commit is selected from git history
  useEffect(() => {
    if (pendingStartCommit) {
      setNewBranchOpen(true)
      setBranchPlaceholder(randomBranchName())
      setStartCommit(pendingStartCommit)
      onClearPendingCommit?.()
      fetchGithubBranches()
    }
  }, [pendingStartCommit, onClearPendingCommit, fetchGithubBranches])

  // Delete branch dialog hook - handles pre-check and state
  const deleteDialog = useDeleteBranchDialog({ repo, onRemoveBranch })

  function startResize() {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const handleCreateBranch = useCallback(async () => {
    const branchName = newBranchName.trim() || branchPlaceholder
    if (!branchName || creating) return

    // Validate branch name using shared validation
    const validationError = validateBranchName(
      branchName,
      repo.branches.map((b) => b.name),
      githubBranches
    )
    if (validationError) {
      setCreateError(validationError)
      return
    }

    if (quota && quota.current >= quota.max) {
      setCreateError(`You have ${quota.current}/${quota.max} sandboxes. Please stop one before creating another.`)
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
      status: BRANCH_STATUS.CREATING,
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
          repoOwner: repo.owner,
          repoName: repo.name,
          baseBranch: newBranchBase,
          newBranch: branchName,
          ...(startCommit ? { startCommit } : {}),
        }),
      })

      if (!res.ok) {
        let message = `Failed to create branch (${res.status})`
        try {
          const data = await res.json()
          message = data.error || data.message || message
        } catch {
          // Ignore parse errors and use fallback message
        }
        throw new Error(message)
      }

      if (!res.body) {
        throw new Error("Failed to create branch: empty server response")
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let hasTerminalEvent = false

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
                hasTerminalEvent = true
                // Use server-side branchId to replace the temporary client-side ID
                onUpdateBranch(branchId, {
                  id: data.branchId, // Replace client ID with server ID
                  status: BRANCH_STATUS.IDLE,
                  sandboxId: data.sandboxId,
                  contextId: data.contextId,
                  previewUrlPattern: data.previewUrlPattern,
                  startCommit: data.startCommit,
                })
                // Refresh quota now that sandbox is created in database
                onQuotaRefresh?.()
              } else if (data.type === "error") {
                hasTerminalEvent = true
                onUpdateBranch(branchId, {
                  status: BRANCH_STATUS.ERROR,
                })
                setCreateError(data.message)
              }
            } catch {}
          }
        }
      }

      if (!hasTerminalEvent) {
        throw new Error("Branch creation did not complete. Please try again.")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create branch"
      onUpdateBranch(branchId, { status: BRANCH_STATUS.ERROR })
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }, [newBranchName, newBranchBase, creating, repo, quota, onAddBranch, onUpdateBranch, onQuotaRefresh, branchPlaceholder, startCommit, githubBranches])

  // Compute width style for desktop vs mobile
  const widthStyle = isMobile ? { width: "100%" } : { width: typeof width === "number" ? width : width }

  return (
    <div className={cn(
      "relative flex h-full flex-col bg-card",
      isMobile ? "flex-1" : "shrink-0 border-r border-border"
    )} style={widthStyle}>
      <a
        href={`https://github.com/${repo.owner}/${repo.name}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 border-b border-border px-4 py-3"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
          <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
        </svg>
        <span className="text-sm font-semibold text-foreground truncate">
          {repo.owner}/{repo.name}
        </span>
      </a>

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

      <div className={cn(
        "flex-1 overflow-y-auto px-2",
        isMobile ? "pb-2" : "pb-2"
      )}>
        {filtered.length === 0 && repo.branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <GitBranch className="h-5 w-5" />
            <p className="text-xs text-center">Create a new branch to start working with an agent</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((branch) => {
              const isActive = branch.id === activeBranchId
              const isBold = branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING || (branch.unread && !isActive)
              return (
                <div key={branch.id} className="group relative">
                  <button
                    onClick={() => onSelectBranch(branch.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left transition-colors",
                      // Larger touch targets on mobile
                      isMobile ? "py-3.5 min-h-[56px]" : "py-2.5",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <StatusDot status={branch.status} unread={branch.unread} isActive={isActive} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "truncate text-sm",
                          isBold ? "font-semibold text-foreground" : "font-medium"
                        )}>
                          {branch.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {branch.status === BRANCH_STATUS.CREATING ? "Setting up..." : agentLabels[branch.agent || "claude-code"]}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteDialog.handleDeleteClick(branch.id)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-all hover:bg-muted-foreground/10 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
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
                  setStartCommit(null)
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
                  setStartCommit(null)
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
                  className="bg-secondary rounded px-1.5 py-0.5 text-[11px] text-foreground border border-border max-w-[150px] truncate"
                  disabled={creating || githubBranchesLoading}
                >
                  {githubBranchesLoading ? (
                    <option>Loading...</option>
                  ) : githubBranches.length > 0 ? (
                    githubBranches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))
                  ) : (
                    <option value={repo.defaultBranch || "main"}>{repo.defaultBranch || "main"}</option>
                  )}
                </select>
              )}
            </div>
            {createError && (
              <p className="text-[11px] text-red-400">{createError}</p>
            )}
            <button
              onClick={handleCreateBranch}
              disabled={creating || githubBranchesLoading}
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
              setNewBranchBase(repo.defaultBranch || "main")
              fetchGithubBranches()
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">New branch</span>
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      <DeleteBranchDialog
        branch={deleteDialog.deletingBranch}
        repo={repo}
        onClose={deleteDialog.handleClose}
        onConfirm={deleteDialog.handleConfirm}
      />

      {/* Resize handle (desktop only) */}
      {!isMobile && (
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
        />
      )}
    </div>
  )
}
