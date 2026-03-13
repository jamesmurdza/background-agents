"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch } from "@/lib/types"
import { agentLabels } from "@/lib/types"
import { generateId } from "@/lib/store"
import { randomBranchName, validateBranchName } from "@/lib/branch-utils"
import { BRANCH_STATUS } from "@/lib/constants"
import { StatusDot } from "@/components/ui/status-dot"
import { Plus, X, LogOut, Settings, Box, ChevronDown, Check, Loader2, GitBranch } from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface Quota {
  current: number
  max: number
  remaining: number
}

interface MobileSidebarDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: Repo[]
  activeRepoId: string | null
  activeBranchId: string | null
  userAvatar?: string | null
  userName?: string | null
  userLogin?: string | null
  onSelectRepo: (repoId: string) => void
  onSelectBranch: (branchId: string) => void
  onRemoveRepo: (repoId: string) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
  onSignOut?: () => void
  quota?: Quota | null
  onAddBranch?: (branch: Branch) => void
  onUpdateBranch?: (branchId: string, updates: Partial<Branch>) => void
  onQuotaRefresh?: () => void
}

export function MobileSidebarDrawer({
  open,
  onOpenChange,
  repos,
  activeRepoId,
  activeBranchId,
  userAvatar,
  userName,
  userLogin,
  onSelectRepo,
  onSelectBranch,
  onRemoveRepo,
  onOpenSettings,
  onOpenAddRepo,
  onSignOut,
  quota,
  onAddBranch,
  onUpdateBranch,
  onQuotaRefresh,
}: MobileSidebarDrawerProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [branchPlaceholder, setBranchPlaceholder] = useState(() => randomBranchName())
  const [newBranchBase, setNewBranchBase] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [githubBranches, setGithubBranches] = useState<string[]>([])
  const [githubBranchesLoading, setGithubBranchesLoading] = useState(false)
  const newBranchInputRef = useRef<HTMLInputElement>(null)

  const activeRepo = repos.find(r => r.id === activeRepoId)

  // Focus input when new branch form opens
  useEffect(() => {
    if (newBranchOpen && newBranchInputRef.current) {
      setTimeout(() => newBranchInputRef.current?.focus(), 100)
    }
  }, [newBranchOpen])

  const fetchGithubBranches = useCallback(async () => {
    if (!activeRepo) return
    setGithubBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(activeRepo.owner)}&repo=${encodeURIComponent(activeRepo.name)}`
      )
      const data = await res.json()
      setGithubBranches(data.branches || [])
    } catch {
      setGithubBranches([])
    } finally {
      setGithubBranchesLoading(false)
    }
  }, [activeRepo])

  const handleCreateBranch = useCallback(async () => {
    if (!activeRepo || !onAddBranch || !onUpdateBranch) return

    const branchName = newBranchName.trim() || branchPlaceholder
    if (!branchName || creating) return

    // Validate branch name using shared validation
    const validationError = validateBranchName(
      branchName,
      activeRepo.branches.map((b) => b.name),
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
    const baseBranch = newBranchBase || activeRepo.defaultBranch || "main"
    const branch: Branch = {
      id: branchId,
      name: branchName,
      agent: "claude-code",
      messages: [],
      status: BRANCH_STATUS.CREATING,
      lastActivity: "now",
      lastActivityTs: Date.now(),
      baseBranch,
    }

    onAddBranch(branch)
    setNewBranchOpen(false)
    setNewBranchName("")
    onOpenChange(false) // Close drawer after starting creation

    try {
      const res = await fetch("/api/sandbox/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoOwner: activeRepo.owner,
          repoName: activeRepo.name,
          baseBranch,
          newBranch: branchName,
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
                onUpdateBranch(branchId, {
                  id: data.branchId,
                  status: BRANCH_STATUS.IDLE,
                  sandboxId: data.sandboxId,
                  contextId: data.contextId,
                  previewUrlPattern: data.previewUrlPattern,
                  startCommit: data.startCommit,
                })
                onQuotaRefresh?.()
              } else if (data.type === "error") {
                hasTerminalEvent = true
                onUpdateBranch(branchId, { status: BRANCH_STATUS.ERROR })
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
  }, [activeRepo, newBranchName, branchPlaceholder, newBranchBase, creating, quota, githubBranches, onAddBranch, onUpdateBranch, onQuotaRefresh, onOpenChange])

  const handleSelectRepo = (repoId: string) => {
    onSelectRepo(repoId)
  }

  const handleSelectBranch = (branchId: string) => {
    onSelectBranch(branchId)
    onOpenChange(false)
  }

  const handleAddRepo = () => {
    onOpenAddRepo()
    onOpenChange(false)
  }

  const handleOpenSettings = () => {
    onOpenSettings()
    onOpenChange(false)
  }

  // Sort branches by last activity
  const sortedBranches = activeRepo
    ? [...activeRepo.branches].sort((a, b) => (b.lastActivityTs ?? 0) - (a.lastActivityTs ?? 0))
    : []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          title="Navigation menu"
          className="h-full w-[300px] max-w-[85vw] p-0 gap-0 [&>button]:hidden"
          style={{ paddingTop: 'var(--safe-area-inset-top)' }}
        >
          <div className="flex h-full flex-col bg-sidebar">
            {/* Workspace/Repo selector - like Slack workspace switcher */}
            <div className="border-b border-border">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors">
                    {activeRepo ? (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-xs font-semibold text-muted-foreground">
                          {activeRepo.name.split("-").length > 1
                            ? (activeRepo.name.split("-")[0][0] + activeRepo.name.split("-")[1][0]).toUpperCase()
                            : activeRepo.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="flex flex-1 flex-col items-start min-w-0">
                          <span className="text-sm font-semibold text-foreground truncate w-full text-left">
                            {activeRepo.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate w-full text-left">
                            {activeRepo.owner}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border">
                          <Plus className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span className="text-sm text-muted-foreground">Select a repository</span>
                      </>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[268px]">
                  {repos.map((repo) => {
                    const isActive = repo.id === activeRepoId
                    const hasRunning = repo.branches.some((b) => b.status === BRANCH_STATUS.RUNNING || b.status === BRANCH_STATUS.CREATING)
                    return (
                      <DropdownMenuItem
                        key={repo.id}
                        onClick={() => handleSelectRepo(repo.id)}
                        className="flex items-center gap-3 cursor-pointer"
                      >
                        <span className={cn(
                          "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold",
                          isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                        )}>
                          {repo.name.split("-").length > 1
                            ? (repo.name.split("-")[0][0] + repo.name.split("-")[1][0]).toUpperCase()
                            : repo.name.slice(0, 2).toUpperCase()}
                          {hasRunning && (
                            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-popover bg-primary" />
                          )}
                        </span>
                        <div className="flex flex-1 flex-col min-w-0">
                          <span className="text-sm truncate">{repo.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{repo.owner}</span>
                        </div>
                        {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleAddRepo} className="cursor-pointer">
                    <Plus className="h-4 w-4" />
                    Add repository
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Branches list - like Slack channels */}
            <div className="flex-1 overflow-y-auto py-2">
              <div className="px-4 pb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Branches
                </span>
                <div className="flex items-center gap-2">
                  {activeRepo && (
                    <span className="text-[10px] text-muted-foreground">
                      {activeRepo.branches.length}
                    </span>
                  )}
                  {activeRepo && onAddBranch && (
                    <button
                      onClick={() => {
                        setNewBranchOpen(true)
                        setBranchPlaceholder(randomBranchName())
                        setNewBranchBase(activeRepo.defaultBranch || "main")
                        setCreateError(null)
                        fetchGithubBranches()
                      }}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* New Branch Form */}
              {newBranchOpen && activeRepo && (
                <div className="mx-3 mb-3 rounded-lg border border-border bg-secondary/50 p-3">
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
                      className="h-8 bg-background border-border text-xs font-mono placeholder:text-muted-foreground/40"
                      disabled={creating}
                    />
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>from</span>
                      <select
                        value={newBranchBase}
                        onChange={(e) => setNewBranchBase(e.target.value)}
                        className="bg-background rounded px-1.5 py-0.5 text-[11px] text-foreground border border-border max-w-[150px] truncate"
                        disabled={creating || githubBranchesLoading}
                      >
                        {githubBranchesLoading ? (
                          <option>Loading...</option>
                        ) : githubBranches.length > 0 ? (
                          githubBranches.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))
                        ) : (
                          <option value={activeRepo.defaultBranch || "main"}>{activeRepo.defaultBranch || "main"}</option>
                        )}
                      </select>
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
              )}

              {!activeRepo ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-muted-foreground">
                  <GitBranch className="h-5 w-5" />
                  <p className="text-xs text-center">Select a repository to see branches</p>
                </div>
              ) : sortedBranches.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-muted-foreground">
                  <GitBranch className="h-5 w-5" />
                  <p className="text-xs text-center">No branches yet</p>
                  <p className="text-[10px] text-muted-foreground/60 text-center">
                    Create a branch to start working
                  </p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {sortedBranches.map((branch) => {
                    const isActive = branch.id === activeBranchId
                    const isBold = branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING || (branch.unread && !isActive)
                    return (
                      <button
                        key={branch.id}
                        onClick={() => handleSelectBranch(branch.id)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition-colors",
                          isActive
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        )}
                      >
                        <StatusDot status={branch.status} unread={branch.unread} isActive={isActive} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={cn(
                            "truncate text-sm",
                            isBold ? "font-semibold text-foreground" : "font-medium"
                          )}>
                            {branch.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {branch.status === BRANCH_STATUS.CREATING ? "Setting up..." : agentLabels[branch.agent || "claude-code"]}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Quota display */}
            {quota && (
              <div className="border-t border-border px-4 py-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Box className="h-3 w-3" />
                    Sandboxes
                  </span>
                  <span className="font-mono">{quota.current}/{quota.max}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      quota.current / quota.max > 0.8 ? "bg-orange-500" : "bg-primary"
                    )}
                    style={{ width: `${Math.min((quota.current / quota.max) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Footer with user info and actions */}
            <div className="border-t border-border" style={{ paddingBottom: 'var(--safe-area-inset-bottom)' }}>
              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-3">
                {userAvatar ? (
                  <img src={userAvatar} alt="" className="h-8 w-8 rounded-md object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-xs font-bold">
                    {userName?.[0]?.toUpperCase() || userLogin?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
                <div className="flex flex-1 flex-col min-w-0">
                  {userName && (
                    <span className="text-sm font-medium text-foreground truncate">
                      {userName}
                    </span>
                  )}
                  {userLogin && (
                    <span className="text-[10px] text-muted-foreground truncate">@{userLogin}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="px-2 pb-2 flex gap-1">
                <button
                  onClick={handleOpenSettings}
                  className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
                {onSignOut && (
                  <button
                    onClick={onSignOut}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Remove repo confirmation modal */}
      <Dialog open={!!removeModalRepo} onOpenChange={(open) => !open && setRemoveModalRepo(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove repository?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {removeModalRepo && removeModalRepo.branches.length > 0 ? (
              <>This will delete {removeModalRepo.branches.length} chat{removeModalRepo.branches.length !== 1 ? "s" : ""} and their sandboxes for <span className="font-semibold text-foreground">{removeModalRepo.owner}/{removeModalRepo.name}</span>. Branches on GitHub will not be affected.</>
            ) : (
              <>Remove <span className="font-semibold text-foreground">{removeModalRepo?.owner}/{removeModalRepo?.name}</span> from the sidebar?</>
            )}
          </p>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setRemoveModalRepo(null)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (removeModalRepo) {
                  onRemoveRepo(removeModalRepo.id)
                  setRemoveModalRepo(null)
                }
              }}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
