"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch, UserCredentialFlags } from "@/lib/types"
import { agentLabels, getDefaultAgent } from "@/lib/types"
import { generateId } from "@/lib/store"
import { randomBranchName, validateBranchName } from "@/lib/branch-utils"
import { BRANCH_STATUS } from "@/lib/constants"
import { createBranchWithSandbox } from "@/lib/branch-actions"
import { StatusDot } from "@/components/ui/status-dot"
import { Plus, LogOut, Settings, Box, ChevronDown, Check, Loader2, GitBranch, Trash2 } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { useState, useEffect, useCallback } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { DeleteBranchDialog, useDeleteBranchDialog } from "@/components/delete-branch-dialog"

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
  credentials?: UserCredentialFlags | null
  onRemoveBranch?: (branchId: string, deleteRemote?: boolean) => void
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
  credentials,
  onRemoveBranch,
}: MobileSidebarDrawerProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)
  const [baseBranchOpen, setBaseBranchOpen] = useState(false)
  const [branchSearch, setBranchSearch] = useState("")
  const [newBranchBase, setNewBranchBase] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [githubBranches, setGithubBranches] = useState<string[]>([])
  const [githubBranchesLoading, setGithubBranchesLoading] = useState(false)

  const activeRepo = repos.find(r => r.id === activeRepoId)
  const fallbackDeleteRepo: Repo = {
    id: "__fallback__",
    name: "",
    owner: "",
    avatar: "",
    defaultBranch: "main",
    branches: [],
  }
  const deleteDialogRepo = activeRepo ?? repos[0] ?? fallbackDeleteRepo

  const deleteDialog = useDeleteBranchDialog({
    repo: deleteDialogRepo,
    onRemoveBranch: onRemoveBranch ?? (() => {}),
  })

  const canDeleteBranch = !!activeRepo && !!onRemoveBranch

  // Reset create branch UI when repo changes
  useEffect(() => {
    setCreateError(null)
    setNewBranchBase(activeRepo?.defaultBranch || "main")
    setGithubBranches([])
  }, [activeRepo?.id, activeRepo?.defaultBranch])

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

  // Fetch github branches every time dropdown opens (to get fresh list)
  const handleBaseBranchOpenChange = useCallback((open: boolean) => {
    setBaseBranchOpen(open)
    if (open) {
      setBranchSearch("")
      fetchGithubBranches()
    }
  }, [fetchGithubBranches])

  const handleCreateBranch = useCallback(async () => {
    if (!activeRepo || !onAddBranch || !onUpdateBranch) return
    if (creating) return

    // Generate a new branch name
    const branchName = randomBranchName()

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
      agent: getDefaultAgent(credentials),
      messages: [],
      status: BRANCH_STATUS.CREATING,
      lastActivity: "now",
      lastActivityTs: Date.now(),
      baseBranch,
    }

    onAddBranch(branch)
    onOpenChange(false) // Close drawer after starting creation

    try {
      await createBranchWithSandbox(
        {
          repoId: activeRepo.id,
          repoOwner: activeRepo.owner,
          repoName: activeRepo.name,
          baseBranch,
          newBranch: branchName,
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
              agent: result.agent,
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
    } finally {
      setCreating(false)
    }
  }, [activeRepo, newBranchBase, creating, quota, githubBranches, onAddBranch, onUpdateBranch, onQuotaRefresh, onOpenChange, credentials])

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
              <div className="flex items-center justify-between gap-2 px-4 pb-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Branches
                </span>
                {activeRepo && onAddBranch && (
                  <div className="flex min-w-0 items-center gap-1">
                    <Popover open={baseBranchOpen} onOpenChange={handleBaseBranchOpenChange}>
                      <PopoverTrigger
                        type="button"
                        className="group flex max-w-[min(11rem,42vw)] cursor-pointer items-center gap-0.5 rounded-md py-1 pl-1 pr-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground data-[state=open]:bg-accent/50 data-[state=open]:text-foreground"
                      >
                        <GitBranch className="h-2.5 w-2.5 shrink-0" />
                        <span className="min-w-0 truncate">
                          from{" "}
                          <span className="text-foreground">
                            {newBranchBase || activeRepo.defaultBranch || "main"}
                          </span>
                        </span>
                        <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </PopoverTrigger>
                      <PopoverContent align="end" sideOffset={4} className="w-[220px] p-0">
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
                                  const defaultBranch = activeRepo.defaultBranch || "main"
                                  const allBranches = githubBranches.length > 0 ? githubBranches : [defaultBranch]

                                  const filteredBranches = branchSearch
                                    ? allBranches.filter(b => b.toLowerCase().includes(branchSearch.toLowerCase()))
                                    : allBranches

                                  const sortedBaseBranches = [...filteredBranches].sort((a, b) => {
                                    if (a === defaultBranch) return -1
                                    if (b === defaultBranch) return 1
                                    return a.localeCompare(b)
                                  })

                                  if (sortedBaseBranches.length === 0) {
                                    return (
                                      <div className="py-3 px-3 text-[11px] text-center text-muted-foreground">
                                        No branches found.
                                      </div>
                                    )
                                  }

                                  return (
                                    <CommandGroup>
                                      {sortedBaseBranches.map((branch) => {
                                        const isDefault = branch === defaultBranch
                                        const isSelected = branch === newBranchBase

                                        return (
                                          <CommandItem
                                            key={branch}
                                            value={branch}
                                            onSelect={() => {
                                              setNewBranchBase(branch)
                                              setBaseBranchOpen(false)
                                            }}
                                            className="flex cursor-pointer items-center justify-between text-[11px]"
                                          >
                                            <span className="flex items-center gap-1.5">
                                              <GitBranch className="h-3 w-3 shrink-0" />
                                              <span>{branch}</span>
                                              {isDefault && (
                                                <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">default</span>
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
                    <button
                      type="button"
                      onClick={() => handleCreateBranch()}
                      disabled={creating || githubBranchesLoading}
                      title="New branch"
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {creating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {createError && (
                <p className="px-4 pb-2 text-[11px] text-red-400">{createError}</p>
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
                      <div key={branch.id} className="group relative">
                        <button
                          onClick={() => handleSelectBranch(branch.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2.5 px-4 pr-10 py-2.5 text-left transition-colors",
                            isActive
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          )}
                        >
                          <StatusDot status={branch.status} unread={branch.unread} isActive={isActive} />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span
                              className={cn(
                                "truncate text-sm",
                                isBold ? "font-semibold text-foreground" : "font-medium"
                              )}
                            >
                              {branch.name}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <AgentIcon agent={branch.agent || "claude-code"} className="h-2 w-2" />
                              {branch.status === BRANCH_STATUS.CREATING
                                ? "Setting up..."
                                : agentLabels[branch.agent || "claude-code"]}
                            </span>
                          </div>
                        </button>

                        {canDeleteBranch && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteDialog.handleDeleteClick(branch.id)
                            }}
                            disabled={branch.status === BRANCH_STATUS.CREATING || deleteDialog.deletingBranchId === branch.id}
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            title="Delete branch"
                          >
                            {deleteDialog.deletingBranchId === branch.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Delete confirmation modal */}
            <DeleteBranchDialog
              branch={deleteDialog.deletingBranch}
              repo={deleteDialogRepo}
              onClose={deleteDialog.handleClose}
              onConfirm={deleteDialog.handleConfirm}
            />

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
              className="cursor-pointer flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
