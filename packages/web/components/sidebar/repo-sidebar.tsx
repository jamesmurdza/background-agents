"use client"

import { cn } from "@/lib/shared/utils"
import type { Repo } from "@/lib/shared/types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import { Plus, X, LogOut, Settings, Box, Shield, Users } from "lucide-react"
import Link from "next/link"
import { useState, useRef } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Quota {
  current: number
  max: number
  remaining: number
}

export interface RepoSidebarProps {
  repos: Repo[]
  activeRepoId: string | null
  userAvatar?: string | null
  userName?: string | null
  userLogin?: string | null
  onSelectRepo: (repoId: string) => void
  onRemoveRepo: (repoId: string) => void
  onReorderRepos: (fromIndex: number, toIndex: number) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
  onSignOut?: () => void
  quota?: Quota | null
  isAdmin?: boolean
}

export function RepoSidebar({
  repos,
  activeRepoId,
  userAvatar,
  userName,
  userLogin,
  onSelectRepo,
  onRemoveRepo,
  onReorderRepos,
  onOpenSettings,
  onOpenAddRepo,
  onSignOut,
  quota,
  isAdmin,
}: RepoSidebarProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: "before" | "after" } | null>(null)

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[60px] sm:w-[60px] shrink-0 flex-col items-center border-r border-border bg-sidebar py-3 overflow-hidden">
        {/* Scrollable container for repository icons */}
        <div className="flex flex-col items-center gap-2 overflow-y-auto flex-1 min-h-0 w-full scrollbar-hide">
        {repos.map((repo, index) => {
          const isActive = repo.id === activeRepoId
          const hasRunning = repo.branches.some((b) => b.status === BRANCH_STATUS.RUNNING || b.status === BRANCH_STATUS.CREATING)
          const nameParts = repo.name.split("-")
          const initials = nameParts.length > 1
            ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
            : repo.name.slice(0, 2).toUpperCase()
          const showDropBefore = dropIndicator?.index === index && dropIndicator?.position === "before"
          const showDropAfter = dropIndicator?.index === index && dropIndicator?.position === "after"
          return (
            <div
              key={repo.id}
              className="relative group"
              draggable
              onDragStart={() => { dragIndexRef.current = index }}
              onDragOver={(e) => {
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const midpoint = rect.top + rect.height / 2
                const position = e.clientY < midpoint ? "before" : "after"
                setDropIndicator({ index, position })
              }}
              onDragLeave={() => setDropIndicator(null)}
              onDrop={() => {
                if (dragIndexRef.current !== null && dropIndicator) {
                  const fromIndex = dragIndexRef.current
                  let toIndex = dropIndicator.index
                  // Adjust target index based on position
                  if (dropIndicator.position === "after") {
                    toIndex = toIndex + 1
                  }
                  // Adjust for the removal of the dragged item
                  if (fromIndex < toIndex) {
                    toIndex = toIndex - 1
                  }
                  if (fromIndex !== toIndex) {
                    onReorderRepos(fromIndex, toIndex)
                  }
                }
                dragIndexRef.current = null
                setDropIndicator(null)
              }}
              onDragEnd={() => { dragIndexRef.current = null; setDropIndicator(null) }}
            >
              {/* Drop indicator line - before */}
              {showDropBefore && dragIndexRef.current !== index && dragIndexRef.current !== index - 1 && (
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
              )}
              {/* Drop indicator line - after */}
              {showDropAfter && dragIndexRef.current !== index && dragIndexRef.current !== index + 1 && (
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelectRepo(repo.id)}
                    className={cn(
                      "relative flex cursor-pointer h-11 w-11 sm:h-10 sm:w-10 items-center justify-center rounded-lg font-mono text-xs font-semibold transition-all overflow-hidden",
                      isActive
                        ? "ring-2 ring-primary"
                        : "hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <span className={cn(
                      "flex h-full w-full items-center justify-center rounded-lg",
                      isActive
                        ? "bg-accent text-foreground"
                        : "bg-secondary text-muted-foreground"
                    )}>
                      {initials}
                    </span>
                    {hasRunning && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{repo.owner}/{repo.name}</TooltipContent>
              </Tooltip>
              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (repo.branches.length === 0) {
                    onRemoveRepo(repo.id)
                    return
                  }
                  setRemoveModalRepo(repo)
                }}
                className="absolute -right-1 -top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all z-10 opacity-0 group-hover:opacity-100 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenAddRepo}
              className="flex cursor-pointer h-11 w-11 sm:h-10 sm:w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Add repository</TooltipContent>
        </Tooltip>
        </div>

        {/* User profile - always visible at bottom */}
        <div className="mt-2 flex flex-col items-center shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex cursor-pointer h-11 w-11 sm:h-10 sm:w-10 items-center justify-center rounded-lg overflow-hidden transition-colors hover:ring-2 hover:ring-primary/50"
              >
                {userAvatar ? (
                  <img src={userAvatar} alt="User menu" className="h-full w-full rounded-lg object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold">
                    {userName?.[0]?.toUpperCase() || userLogin?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              {/* User info header */}
              <div className="px-2 py-2">
                <div className="flex items-center gap-2">
                  {userAvatar ? (
                    <img src={userAvatar} alt="" className="h-8 w-8 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-xs font-bold">
                      {userName?.[0]?.toUpperCase() || userLogin?.[0]?.toUpperCase() || "?"}
                    </span>
                  )}
                  <div className="flex flex-col">
                    {userName && (
                      <a
                        href={`https://github.com/${userLogin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-foreground truncate"
                      >
                        {userName}
                      </a>
                    )}
                    {userLogin && (
                      <span className="text-xs text-muted-foreground truncate">@{userLogin}</span>
                    )}
                  </div>
                </div>
              </div>

              <DropdownMenuSeparator />

              {/* Quota display */}
              {quota && (
                <>
                  <div className="px-2 py-2">
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
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Menu items */}
              <DropdownMenuItem onClick={onOpenSettings} className="cursor-pointer text-xs">
                <Settings className="h-3.5 w-3.5" />
                Settings
              </DropdownMenuItem>

              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link href="/team">
                  <Users className="h-3.5 w-3.5" />
                  Team
                </Link>
              </DropdownMenuItem>

              {isAdmin && (
                <DropdownMenuItem asChild className="cursor-pointer text-xs">
                  <Link href="/admin">
                    <Shield className="h-3.5 w-3.5" />
                    Admin
                  </Link>
                </DropdownMenuItem>
              )}

              {onSignOut && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onSignOut} variant="destructive" className="cursor-pointer text-xs">
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Remove repo confirmation modal — only shown if repo has chats */}
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
    </TooltipProvider>
  )
}
