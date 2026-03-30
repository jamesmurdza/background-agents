"use client"

import { cn } from "@/lib/shared/utils"
import type { Branch } from "@/lib/shared/types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import {
  Pencil,
  GitPullRequest,
  Loader2,
  GitMerge,
  GitCompareArrows,
  History,
  Diff,
  FolderSync,
  Play,
  Pause,
  Sparkles,
  XCircle,
  AlertTriangle,
} from "lucide-react"
import type { RebaseConflictState } from "@/components/git/hooks/useGitDialogs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { UseGitActionsReturn } from "./hooks/useGitActions"
import type { UseBranchRenamingReturn } from "./hooks/useBranchRenaming"

// ============================================================================
// Header Actions Config
// ============================================================================

const headerActions = [
  { icon: GitPullRequest, label: "Create PR", action: "create-pr" },
  { icon: GitMerge, label: "Merge", action: "merge" },
  { icon: GitCompareArrows, label: "Rebase", action: "rebase" },
  { icon: Diff, label: "Diff", action: "diff" },
  { icon: History, label: "Log", action: "log" },
]

// ============================================================================
// Chat Header Component
// ============================================================================

interface ChatHeaderProps {
  branch: Branch
  repoFullName: string
  gitHistoryOpen: boolean
  gitActions: UseGitActionsReturn
  renaming: UseBranchRenamingReturn
  rebaseConflict?: RebaseConflictState
  onAbortRebase?: () => void
}

export function ChatHeader({
  branch,
  repoFullName,
  gitHistoryOpen,
  gitActions,
  renaming,
  rebaseConflict,
  onAbortRebase,
}: ChatHeaderProps) {
  const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)
  const isBusy = branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING
  const inConflict = (rebaseConflict?.inRebase || rebaseConflict?.inMerge) ?? false

  return (
    <header className={cn(
      "flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:px-4",
      inConflict ? "border-red-500/50 bg-red-500/10" : "border-border"
    )}>
      {/* Branch name section */}
      {renaming.renaming ? (
        <div className="flex items-center gap-1.5 min-w-0 ml-2.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
            <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
          </svg>
          <div className="inline-grid min-w-0 [&>*]:[grid-area:1/1]">
            <span className="invisible whitespace-pre px-1.5 text-xs font-mono">{renaming.renameValue || " "}</span>
            <input
              ref={renaming.renameInputRef}
              value={renaming.renameValue}
              onChange={(e) => renaming.setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renaming.handleRename()
                if (e.key === "Escape") renaming.cancelRenaming()
              }}
              onBlur={renaming.cancelRenaming}
              disabled={renaming.renameLoading || renaming.suggesting}
              className="h-6 bg-transparent border border-border/30 rounded px-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-border/60 min-w-[3ch] disabled:text-muted-foreground"
              autoFocus
            />
          </div>
          {(renaming.renameLoading || renaming.suggesting) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0 ml-2.5 group/branch-section">
          <button
            onClick={renaming.startRenaming}
            className="flex items-center gap-1.5 min-w-0 py-1 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
              <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
            </svg>
            <span className="truncate text-xs font-mono text-muted-foreground">{branch.name}</span>
            <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60 group-hover/branch-section:text-muted-foreground transition-colors" />
          </button>
          {/* Magic wand button for AI-suggested branch name */}
          {renaming.canSuggestName && (
            <button
              onClick={renaming.suggestBranchName}
              disabled={renaming.suggesting}
              title="Suggest branch name from chat"
              className="cursor-pointer disabled:cursor-not-allowed"
            >
              {renaming.suggesting ? (
                <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Sparkles className="h-2.5 w-2.5 shrink-0 text-muted-foreground/70 group-hover/branch-section:text-foreground transition-colors" />
              )}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto ml-auto">
        {branch.sandboxId && (<>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={gitActions.handleSandboxToggle}
                disabled={gitActions.sandboxToggleLoading || branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING}
                className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {gitActions.sandboxToggleLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : branch.status === BRANCH_STATUS.STOPPED ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {branch.status === BRANCH_STATUS.STOPPED ? "Start sandbox" : "Pause sandbox"}
            </TooltipContent>
          </Tooltip>
          <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://github.com/${repoFullName}/tree/${branch.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Open on GitHub</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={gitActions.handleVSCodeClick}
                className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
                  <path d="M70.9 97.8l25.3-12.2c2.3-1.1 3.8-3.5 3.8-6.1V20.5c0-2.6-1.5-5-3.8-6.1L70.9 2.2c-2.9-1.4-6.3-.9-8.6 1.2L26.2 37.7 10.8 26.1c-1.9-1.5-4.6-1.3-6.3.3l-3.2 2.9c-1.9 1.7-1.9 4.7 0 6.5L14.9 50 1.3 64.3c-1.9 1.7-1.9 4.7 0 6.5l3.2 2.9c1.7 1.6 4.4 1.8 6.3.3l15.4-11.6 36.1 34.3c1.5 1.4 3.5 2.1 5.5 2.1.3 0 2.1-.5 3.1-1zM71 27.5L40.4 50 71 72.5V27.5z" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Open in VS Code</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={gitActions.handleRsyncClick}
                className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <FolderSync className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Sync to local</TooltipContent>
          </Tooltip>
          <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
        </>)}

        {/* Conflict warning indicator */}
        {inConflict && (
          <>
            <div className="flex items-center gap-1.5 text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {rebaseConflict?.inMerge ? "Merge" : "Rebase"} Conflict
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onAbortRebase}
                  disabled={gitActions.gitDialogs.actionLoading}
                  className="flex cursor-pointer h-7 px-2 shrink-0 items-center justify-center gap-1.5 rounded-md bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {gitActions.gitDialogs.actionLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs font-medium">
                    Abort {rebaseConflict?.inMerge ? "Merge" : "Rebase"}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Abort the {rebaseConflict?.inMerge ? "merge" : "rebase"} and return to the previous state
              </TooltipContent>
            </Tooltip>
            <div className="mx-1.5 h-4 w-px bg-red-500/30 shrink-0" />
          </>
        )}

        {headerActions.map((action) => {
          const isActive = action.action === "log" && gitHistoryOpen
          const hasPR = action.action === "create-pr" && !!branch.prUrl
          const isPRLoading = action.action === "create-pr" && gitActions.actionLoading === "create-pr"
          const isDiff = action.action === "diff"
          const hasDiffChanges = isDiff && gitActions.hasChanges
          // PR button should be enabled when it already has a PR URL (just opens the PR)
          // Diff and Log can always be used while busy
          const canUseWhileBusy = action.action === "log" || action.action === "diff" || hasPR

          // Hide merge, rebase, and create-pr buttons during conflict
          const hideInConflict = ["create-pr", "merge", "rebase"].includes(action.action)
          if (inConflict && hideInConflict) {
            return null
          }

          return (
            <Tooltip key={action.label}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => gitActions.handleHeaderAction(action.action)}
                  disabled={!isReady || (isBusy && !canUseWhileBusy) || isPRLoading}
                  className={cn(
                    "flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                    hasPR || hasDiffChanges
                      ? "text-green-400"
                      : isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {isPRLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <action.icon className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {hasPR ? "Open PR" : action.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </header>
  )
}
