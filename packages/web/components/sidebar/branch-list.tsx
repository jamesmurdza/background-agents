"use client"

import { cn } from "@/lib/shared/utils"
import type { Repo, Branch, UserCredentialFlags } from "@/lib/shared/types"
import { agentLabels, getDefaultAgent } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { randomBranchName, validateBranchName } from "@/lib/git/branch-utils"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import { createBranchWithSandbox } from "@/lib/git/branch-actions"
import { StatusDot } from "@/components/ui/status-dot"
import { DeleteBranchDialog, useDeleteBranchDialog } from "@/components/modals/delete-branch-dialog"
import { GitBranch, Plus, Search, ChevronDown, Loader2, X, Settings, Check } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { Input } from "@/components/ui/input"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { useBranchDiffStats } from "./hooks/useBranchDiffStats"

interface BranchListProps {
  repo: Repo
  activeBranchId: string | null
  onSelectBranch: (branchId: string) => void
  onAddBranch: (branch: Branch) => void
  onRemoveBranch: (branchId: string, deleteRemote?: boolean) => void
  onSwitchAwayFromBranchBeforeDelete?: (branchId: string) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  onQuotaRefresh?: () => void
  quota?: { current: number; max: number; remaining: number } | null
  width: number | string
  onWidthChange: (w: number) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  pendingStartCommit?: string | null
  onClearPendingCommit?: () => void
  isMobile?: boolean
  credentials?: UserCredentialFlags | null
  onOpenRepoSettings?: () => void
}

export function BranchList({
  repo,
  activeBranchId,
  onSelectBranch,
  onAddBranch,
  onRemoveBranch,
  onSwitchAwayFromBranchBeforeDelete,
  onUpdateBranch,
  onQuotaRefresh,
  quota,
  width,
  onWidthChange,
  collapsed = false,
  onToggleCollapse,
  pendingStartCommit,
  onClearPendingCommit,
  isMobile = false,
  credentials,
  onOpenRepoSettings,
}: BranchListProps) {
  const [search, setSearch] = useState("")
  const [baseBranchOpen, setBaseBranchOpen] = useState(false)
  const [branchSearch, setBranchSearch] = useState("")
  const [newBranchBase, setNewBranchBase] = useState(repo.preferredBaseBranch || repo.defaultBranch || "main")
  // Sync base branch when repo data changes (e.g. after preferredBaseBranch is persisted and reloaded)
  const effectiveBase = repo.preferredBaseBranch || repo.defaultBranch || "main"
  const prevEffectiveBaseRef = useRef(effectiveBase)
  useEffect(() => {
    if (effectiveBase !== prevEffectiveBaseRef.current) {
      setNewBranchBase(effectiveBase)
      prevEffectiveBaseRef.current = effectiveBase
    }
  }, [effectiveBase])
  const [createError, setCreateError] = useState<string | null>(null)
  const [startCommit, setStartCommit] = useState<string | null>(null)
  const [githubBranches, setGithubBranches] = useState<string[]>([])
  const [githubBranchesLoading, setGithubBranchesLoading] = useState(false)
  const isResizing = useRef(false)

  // Fetch diff stats for branches with sandboxes
  const { diffStatsMap } = useBranchDiffStats({
    branches: repo.branches,
    repoOwner: repo.owner,
    repoName: repo.name,
  })

  const filtered = repo.branches
    .filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.lastActivityTs ?? 0) - (a.lastActivityTs ?? 0))

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


  // Reset create branch UI when repo changes
  useEffect(() => {
    setCreateError(null)
    setStartCommit(null)
    setNewBranchBase(repo.preferredBaseBranch || repo.defaultBranch || "main")
    setGithubBranches([])
  }, [repo.id, repo.preferredBaseBranch, repo.defaultBranch])

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

  // Fetch github branches every time dropdown opens (to get fresh list)
  const handleBaseBranchOpenChange = useCallback((open: boolean) => {
    setBaseBranchOpen(open)
    if (open) {
      setBranchSearch("")
      fetchGithubBranches()
    }
  }, [fetchGithubBranches])

  // Delete branch dialog hook - handles pre-check and state
  const deleteDialog = useDeleteBranchDialog({
    repo,
    onRemoveBranch,
    onSwitchAwayFromBranchBeforeDelete,
  })

  function startResize() {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const handleCreateBranch = useCallback(async (commitOverride?: string) => {
    // Generate a new branch name
    const branchName = randomBranchName()

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

    setCreateError(null)

    const branchId = generateId()
    const commitToUse = commitOverride || startCommit
    const branch: Branch = {
      id: branchId,
      name: branchName,
      agent: getDefaultAgent(credentials),
      messages: [],
      status: BRANCH_STATUS.CREATING,
      lastActivity: "now",
      lastActivityTs: Date.now(),
      baseBranch: newBranchBase,
    }

    onAddBranch(branch)
    setStartCommit(null)

    try {
      await createBranchWithSandbox(
        {
          repoId: repo.id,
          repoOwner: repo.owner,
          repoName: repo.name,
          baseBranch: newBranchBase,
          newBranch: branchName,
          startCommit: commitToUse || undefined,
        },
        {
          onDone: (result) => {
            onUpdateBranch(branchId, {
              id: result.branchId,
              status: BRANCH_STATUS.IDLE,
              sandboxId: result.sandboxId,
              contextId: result.contextId,
              previewUrlPattern: result.previewUrlPattern,
              startCommit: result.startCommit,
            })
            onQuotaRefresh?.()
          },
          onError: (message) => {
            onUpdateBranch(branchId, { status: BRANCH_STATUS.ERROR })
            setCreateError(message)
          },
        }
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create branch"
      onUpdateBranch(branchId, { status: BRANCH_STATUS.ERROR })
      setCreateError(message)
    }
  }, [newBranchBase, repo, quota, onAddBranch, onUpdateBranch, onQuotaRefresh, startCommit, githubBranches, credentials])

  // Handle creating branch from a commit selected in git history
  useEffect(() => {
    if (pendingStartCommit) {
      onClearPendingCommit?.()
      // Auto-create branch from the selected commit
      handleCreateBranch(pendingStartCommit)
    }
  }, [pendingStartCommit, onClearPendingCommit, handleCreateBranch])

  // Compute width style for desktop vs mobile
  const widthStyle = isMobile ? { width: "100%" } : { width: typeof width === "number" ? width : width }

  // Collapsed state: show minimal view with just the resize handle
  if (collapsed && !isMobile) {
    return (
      <div
        className="relative flex h-full shrink-0 flex-col bg-card border-r border-border"
        style={{ width: 0 }}
      >
        {/* Resize handle for expanding */}
        <div
          onMouseDown={startResize}
          onDoubleClick={onToggleCollapse}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
          title="Double-click to expand"
        />
      </div>
    )
  }

  return (
    <div className={cn(
      "relative flex h-full flex-col bg-card",
      isMobile ? "flex-1" : "shrink-0 border-r border-border"
    )} style={widthStyle}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <a
          href={`https://github.com/${repo.owner}/${repo.name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 min-w-0 flex-1"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
          </svg>
          <span className="text-sm font-semibold text-foreground truncate">
            {repo.owner}/{repo.name}
          </span>
        </a>
        {onOpenRepoSettings && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenRepoSettings()
            }}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Repository settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
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

      <div className="flex-1 overflow-y-auto px-2 py-2">
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
              const isDeleting = deleteDialog.deletingBranchId === branch.id
              const isCreating = branch.status === BRANCH_STATUS.CREATING
              const branchDiffStats = diffStatsMap.get(branch.id)

              const branchButton = (
                <button
                  type="button"
                  onClick={() => onSelectBranch(branch.id)}
                  disabled={isDeleting}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left transition-colors",
                    // Larger touch targets on mobile
                    isMobile ? "py-3.5 min-h-[56px]" : "py-2.5",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    isDeleting && "cursor-not-allowed"
                  )}
                >
                  {isDeleting ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground opacity-40" />
                    </span>
                  ) : (
                    <StatusDot status={branch.status} unread={branch.unread} isActive={isActive} />
                  )}
                  <div className={cn(
                    "flex min-w-0 flex-1 flex-col gap-0.5 transition-opacity",
                    isDeleting && "opacity-40"
                  )}>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "truncate text-sm",
                        isBold ? "font-semibold text-foreground" : "font-medium"
                      )}>
                        {branch.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <AgentIcon agent={branch.agent || "claude-code"} className="h-2.5 w-2.5" />
                        {branch.status === BRANCH_STATUS.CREATING ? "Setting up..." : agentLabels[branch.agent || "claude-code"]}
                      </span>
                      {branchDiffStats && (branchDiffStats.additions > 0 || branchDiffStats.deletions > 0) && (
                        <span className="flex items-center gap-1 text-[10px]">
                          {branchDiffStats.additions > 0 && <span style={{ color: "#1a7f37" }}>+{branchDiffStats.additions}</span>}
                          {branchDiffStats.deletions > 0 && <span style={{ color: "#d1242f" }}>-{branchDiffStats.deletions}</span>}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )

              return (
                <div key={branch.id} className="group relative">
                  {branchButton}
                  {!isDeleting && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (e.altKey) {
                          deleteDialog.handleConfirm(branch.id, false)
                        } else {
                          deleteDialog.handleDeleteClick(branch.id)
                        }
                      }}
                      disabled={isCreating}
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-all hover:bg-muted-foreground/10 hover:text-foreground opacity-0 group-hover:opacity-100",
                        isCreating && "cursor-not-allowed"
                      )}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* New Branch Section */}
      <div className="border-t border-border p-3">
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleCreateBranch()}
            disabled={githubBranchesLoading}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">New branch</span>
          </button>

          {createError && (
            <p className="text-[11px] text-red-400">{createError}</p>
          )}

          {/* Starting branch selector */}
          <Popover open={baseBranchOpen} onOpenChange={handleBaseBranchOpenChange}>
            <PopoverTrigger className="group flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground cursor-pointer">
              <GitBranch className="h-2.5 w-2.5 shrink-0" />
              <span>Starting branch: {newBranchBase}</span>
              <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-[220px] p-0">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search branches..."
                  className="h-8 text-[11px]"
                  value={branchSearch}
                  onValueChange={setBranchSearch}
                />
                <CommandList>
                  {githubBranchesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Loading branches...</span>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const defaultBranch = repo.defaultBranch || "main"
                        const allBranches = githubBranches.length > 0 ? githubBranches : [defaultBranch]

                        // Filter by search term
                        const filteredBranches = branchSearch
                          ? allBranches.filter(b => b.toLowerCase().includes(branchSearch.toLowerCase()))
                          : allBranches

                        // Sort: default branch first, then rest alphabetically
                        const sortedBranches = [...filteredBranches].sort((a, b) => {
                          if (a === defaultBranch) return -1
                          if (b === defaultBranch) return 1
                          return a.localeCompare(b)
                        })

                        if (sortedBranches.length === 0) {
                          return (
                            <div className="py-3 px-3 text-[11px] text-center text-muted-foreground">
                              No branches found.
                            </div>
                          )
                        }

                        return (
                          <CommandGroup>
                            {sortedBranches.map((branch) => {
                              const isDefault = branch === defaultBranch
                              const isSelected = branch === newBranchBase

                              return (
                                <CommandItem
                                  key={branch}
                                  value={branch}
                                  onSelect={() => {
                                    setNewBranchBase(branch)
                                    setBaseBranchOpen(false)
                                    // Persist the preferred base branch
                                    fetch(`/api/repos/${repo.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ preferredBaseBranch: branch }),
                                    }).catch(() => {})
                                  }}
                                  className="flex items-center justify-between text-[11px] cursor-pointer"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <GitBranch className="h-3 w-3 shrink-0" />
                                    <span>{branch}</span>
                                    {isDefault && (
                                      <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">default</span>
                                    )}
                                  </span>
                                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                                </CommandItem>
                              )
                            })}
                          </CommandGroup>
                        )
                      })()}
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

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
          onDoubleClick={onToggleCollapse}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
          title="Double-click to collapse/expand"
        />
      )}
    </div>
  )
}
