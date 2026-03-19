"use client"

import { cn } from "@/lib/utils"
import type { Branch } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"
import {
  Menu,
  GitPullRequest,
  Loader2,
  Pause,
  Play,
  History,
  Diff,
  MoreVertical,
  GitMerge,
  GitCompareArrows,
  Tag,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface MobileHeaderProps {
  repoOwner: string | null
  repoName: string | null
  branch: Branch | null
  onOpenSidebar: () => void
  onToggleGitHistory: () => void
  onOpenDiff: () => void
  onCreatePR: () => void
  onSandboxToggle: () => void
  onMerge: () => void
  onRebase: () => void
  onTag: () => void
  gitHistoryOpen: boolean
  sandboxToggleLoading: boolean
  prLoading: boolean
}

export function MobileHeader({
  repoOwner,
  repoName,
  branch,
  onOpenSidebar,
  onToggleGitHistory,
  onOpenDiff,
  onCreatePR,
  onSandboxToggle,
  onMerge,
  onRebase,
  onTag,
  gitHistoryOpen,
  sandboxToggleLoading,
  prLoading,
}: MobileHeaderProps) {
  const isStopped = branch?.status === BRANCH_STATUS.STOPPED
  const isRunning = branch?.status === BRANCH_STATUS.RUNNING || branch?.status === BRANCH_STATUS.CREATING
  const hasPR = !!branch?.prUrl
  const hasSandbox = !!branch?.sandboxId

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-2"
      style={{ paddingTop: 'calc(var(--safe-area-inset-top) + 0.5rem)' }}
    >
      {/* Hamburger menu button */}
      <button
        onClick={onOpenSidebar}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Repo/Branch info - center */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {repoOwner && repoName ? (
          <>
            <span className="text-[10px] text-muted-foreground truncate">
              {repoOwner}/{repoName}
            </span>
            {branch ? (
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
                  <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
                </svg>
                <span className="text-sm font-medium text-foreground truncate font-mono">
                  {branch.name}
                </span>
                {isRunning && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No branch selected</span>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No repository selected</span>
        )}
      </div>

      {/* Action buttons - right side */}
      <div className="flex items-center gap-0.5">
        {/* GitHub link - always visible when repo is selected */}
        {repoOwner && repoName && branch && (
          <a
            href={`https://github.com/${repoOwner}/${repoName}/tree/${branch.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Open on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        )}
        {hasSandbox && (
          <>
            {/* Git actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={isRunning}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {/* Sandbox toggle */}
                <DropdownMenuItem
                  onClick={onSandboxToggle}
                  disabled={sandboxToggleLoading || isRunning}
                  className="cursor-pointer"
                >
                  {sandboxToggleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isStopped ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                  {isStopped ? "Start sandbox" : "Pause sandbox"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* PR */}
                <DropdownMenuItem
                  onClick={onCreatePR}
                  disabled={prLoading}
                  className="cursor-pointer"
                >
                  {prLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GitPullRequest className={cn("h-4 w-4", hasPR && "text-green-400")} />
                  )}
                  {hasPR ? "Open PR" : "Create PR"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Diff */}
                <DropdownMenuItem onClick={onOpenDiff} className="cursor-pointer">
                  <Diff className="h-4 w-4" />
                  View Diff
                </DropdownMenuItem>

                {/* Git History */}
                <DropdownMenuItem onClick={onToggleGitHistory} className="cursor-pointer">
                  <History className={cn("h-4 w-4", gitHistoryOpen && "text-primary")} />
                  Git Log
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Merge */}
                <DropdownMenuItem onClick={onMerge} className="cursor-pointer">
                  <GitMerge className="h-4 w-4" />
                  Merge
                </DropdownMenuItem>

                {/* Rebase */}
                <DropdownMenuItem onClick={onRebase} className="cursor-pointer">
                  <GitCompareArrows className="h-4 w-4" />
                  Rebase
                </DropdownMenuItem>

                {/* Tag */}
                <DropdownMenuItem onClick={onTag} className="cursor-pointer">
                  <Tag className="h-4 w-4" />
                  Create Tag
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  )
}
