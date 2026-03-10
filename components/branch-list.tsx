"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch } from "@/lib/types"
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
  onRemoveBranch: (branchId: string, deleteRemote?: boolean) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  quota?: { current: number; max: number; remaining: number } | null
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

  if (branch.unread && !isActive) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-foreground" />
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

  if (branch.status === "stopped") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
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
  quota,
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

  const [deleteModalBranchId, setDeleteModalBranchId] = useState<string | null>(null)
  const [deleteModalMergeStatus, setDeleteModalMergeStatus] = useState<"loading" | "merged" | "unmerged" | "error">("loading")
  const [deleteRemoteChecked, setDeleteRemoteChecked] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const deleteModalBranch = deleteModalBranchId ? repo.branches.find((b) => b.id === deleteModalBranchId) : null

  // Handle delete button click - check if branch exists on GitHub first
  const handleDeleteClick = useCallback(async (branchId: string) => {
    const branch = repo.branches.find((b) => b.id === branchId)
    if (!branch) return

    // Check if branch exists on GitHub
    try {
      const baseBranch = branch.baseBranch || repo.defaultBranch || "main"
      const res = await fetch(
        `/api/github/check-merged?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}&branch=${encodeURIComponent(branch.name)}&baseBranch=${encodeURIComponent(baseBranch)}`
      )
      const data = await res.json()

      // If branch doesn't exist on GitHub, delete immediately without modal
      if (res.ok && data.notFound) {
        onRemoveBranch(branchId, false)
        return
      }
    } catch {
      // On error, fall through to show modal
    }

    // Branch exists on GitHub (or we couldn't check), show the modal
    setDeleteModalBranchId(branchId)
  }, [repo.branches, repo.owner, repo.name, repo.defaultBranch, onRemoveBranch])

  // Check if branch is merged when delete modal opens
  useEffect(() => {
    if (!deleteModalBranchId || !deleteModalBranch) return

    setDeleteModalMergeStatus("loading")
    setDeleteRemoteChecked(false)

    const checkMerged = async () => {
      try {
        const baseBranch = deleteModalBranch.baseBranch || repo.defaultBranch || "main"
        const res = await fetch(
          `/api/github/check-merged?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}&branch=${encodeURIComponent(deleteModalBranch.name)}&baseBranch=${encodeURIComponent(baseBranch)}`
        )
        const data = await res.json()
        if (res.ok) {
          const isMerged = data.isMerged
          setDeleteModalMergeStatus(isMerged ? "merged" : "unmerged")
          // Default to checking the delete on GitHub option if branch is merged
          if (isMerged) {
            setDeleteRemoteChecked(true)
          }
        } else {
          setDeleteModalMergeStatus("error")
        }
      } catch {
        setDeleteModalMergeStatus("error")
      }
    }
    checkMerged()
  }, [deleteModalBranchId, deleteModalBranch, repo.owner, repo.name, repo.defaultBranch])

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
    // Check for duplicates in local branches
    if (repo.branches.some((b) => b.name === branchName)) {
      setCreateError("A branch with this name already exists")
      return
    }
    // Check for duplicates in GitHub remote branches
    if (githubBranches.includes(branchName)) {
      setCreateError("A branch with this name already exists on GitHub")
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
                // Use server-side branchId to replace the temporary client-side ID
                onUpdateBranch(branchId, {
                  id: data.branchId, // Replace client ID with server ID
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
  }, [newBranchName, newBranchBase, creating, repo, onAddBranch, onUpdateBranch, branchPlaceholder, startCommit, githubBranches])

  return (
    <div className="relative flex h-full shrink-0 flex-col border-r border-border bg-card" style={{ width }}>
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
                        <span className={cn(
                          "truncate text-sm",
                          isBold ? "font-semibold text-foreground" : "font-medium"
                        )}>
                          {branch.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {branch.status === "creating" ? "Setting up..." : agentLabels[branch.agent || "claude-code"]}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteClick(branch.id)
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
      <Dialog open={!!deleteModalBranchId} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteModalBranchId(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove branch</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Are you sure you want to remove <span className="font-semibold text-foreground">{deleteModalBranch?.name}</span>? This will delete the chat history and sandbox.
            </p>

            {/* Merge status and GitHub deletion option */}
            {deleteModalMergeStatus === "loading" ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Checking branch status...</span>
              </div>
            ) : deleteModalMergeStatus === "merged" ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/50 p-3">
                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                  <span className="font-medium">Branch is fully merged</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteRemoteChecked}
                    onChange={(e) => setDeleteRemoteChecked(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                    disabled={isDeleting}
                  />
                  <span>Also delete branch on GitHub</span>
                </label>
              </div>
            ) : deleteModalMergeStatus === "unmerged" ? (
              <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary/50 p-3">
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" />
                  </svg>
                  <span className="font-medium">Branch has unmerged changes</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  The branch will remain on GitHub. You can delete it manually from GitHub after reviewing the changes.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Unable to check branch status. The branch will remain on GitHub.</span>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setDeleteModalBranchId(null)}
              disabled={isDeleting}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (deleteModalBranchId && deleteModalBranch) {
                  setIsDeleting(true)
                  try {
                    onRemoveBranch(deleteModalBranchId, deleteRemoteChecked)
                  } finally {
                    setIsDeleting(false)
                    setDeleteModalBranchId(null)
                    setDeleteRemoteChecked(false)
                  }
                }
              }}
              disabled={isDeleting || deleteModalMergeStatus === "loading"}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
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
