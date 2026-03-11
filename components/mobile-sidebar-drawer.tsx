"use client"

import { cn } from "@/lib/utils"
import type { Repo, Branch } from "@/lib/types"
import { agentLabels } from "@/lib/types"
import { Plus, X, LogOut, Settings, Box, ChevronDown, Check, Loader2, GitBranch } from "lucide-react"
import { useState } from "react"
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
}

function StatusDot({ branch, isActive }: { branch: Branch; isActive: boolean }) {
  if (branch.status === "running" || branch.status === "creating") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
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
}: MobileSidebarDrawerProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)

  const activeRepo = repos.find(r => r.id === activeRepoId)

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
                    const hasRunning = repo.branches.some((b) => b.status === "running" || b.status === "creating")
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
                {activeRepo && (
                  <span className="text-[10px] text-muted-foreground">
                    {activeRepo.branches.length}
                  </span>
                )}
              </div>

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
                    const isBold = branch.status === "running" || branch.status === "creating" || (branch.unread && !isActive)
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
                        <StatusDot branch={branch} isActive={isActive} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={cn(
                            "truncate text-sm",
                            isBold ? "font-semibold text-foreground" : "font-medium"
                          )}>
                            {branch.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {branch.status === "creating" ? "Setting up..." : agentLabels[branch.agent || "claude-code"]}
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
