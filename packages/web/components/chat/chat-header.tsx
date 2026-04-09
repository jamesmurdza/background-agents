"use client"

import type { ReactNode } from "react"
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
  X,
  Terminal,
  Globe,
} from "lucide-react"
import { useUIStore } from "@/lib/stores/ui-store"
import type { RebaseConflictState } from "@/components/git/hooks/useGitDialogs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { UseGitActionsReturn } from "./hooks/useGitActions"
import type { UseBranchRenamingReturn } from "./hooks/useBranchRenaming"
import { DiffStatsTooltip, diffStatsTooltipClass } from "@/components/ui/diff-stats-tooltip"

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
  onAbortConflict?: () => void
}

export function ChatHeader({
  branch,
  repoFullName,
  gitHistoryOpen,
  gitActions,
  renaming,
  rebaseConflict,
  onAbortConflict,
}: ChatHeaderProps) {
  const {
    openContentPanel,
    addTerminalTab,
    contentPanelTabs,
    contentPanelOpen,
    contentPanelCollapsed,
    contentPanelActiveTabId,
    setActiveTab,
  } = useUIStore()

  // Check if there's an active server
  const serverTab = contentPanelTabs.find(t => t.type === "server")
  const hasActiveServer = !!serverTab

  // Check if there's an existing terminal tab
  const terminalTab = contentPanelTabs.find(t => t.type === "terminal")
  const activeTab = contentPanelTabs.find(t => t.id === contentPanelActiveTabId)
  const isTerminalActive = activeTab?.type === "terminal"

  const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)
  const isBusy = branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)
  const mergeConflict = rebaseConflict?.inMerge ?? false

  const handleOpenTerminal = () => {
    // If panel is collapsed or closed, just open/uncollapse and show existing terminal (or create one)
    if (!contentPanelOpen || contentPanelCollapsed) {
      openContentPanel()
      if (terminalTab) {
        setActiveTab(terminalTab.id)
      } else {
        addTerminalTab(true)
      }
      return
    }

    // Panel is open and not collapsed
    // If terminal is already showing, create a new one
    if (isTerminalActive) {
      addTerminalTab(true)
    } else if (terminalTab) {
      // Switch to existing terminal
      setActiveTab(terminalTab.id)
    } else {
      // No terminal exists, create one
      addTerminalTab(true)
    }
  }

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:px-4",
        inConflict
          ? "border-b-red-700 bg-red-700/12 dark:border-b-red-600 dark:bg-red-950/45"
          : "border-border"
      )}
    >
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
          {(renaming.renameLoading || renaming.suggesting) && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" aria-hidden />
          )}
          {/* Magic wand — single spinner is shown beside input; keep icon here while loading */}
          {renaming.canSuggestName && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()} // Prevent input blur before click
              onClick={renaming.suggestBranchName}
              disabled={renaming.suggesting || renaming.renameLoading}
              title="Suggest branch name from chat"
              className="cursor-pointer disabled:cursor-not-allowed"
            >
              <Sparkles
                className={cn(
                  "h-3 w-3 shrink-0 text-muted-foreground/70 transition-colors",
                  renaming.suggesting && "opacity-40",
                  !renaming.suggesting && "hover:text-foreground"
                )}
              />
            </button>
          )}
          {/* Cancel — hidden while loading so only one spinner shows; Escape still cancels */}
          {!(renaming.renameLoading || renaming.suggesting) && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()} // Prevent input blur before click
              onClick={renaming.cancelRenaming}
              title="Cancel"
              className="cursor-pointer"
            >
              <X className="h-3 w-3 shrink-0 text-muted-foreground/70 hover:text-foreground transition-colors" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0 ml-2.5">
          <a
            href={`https://github.com/${repoFullName}/tree/${branch.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 min-w-0 py-1 cursor-pointer group/branch-link"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground group-hover/branch-link:text-foreground transition-colors">
              <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
            </svg>
            <span className="truncate text-xs font-mono text-muted-foreground group-hover/branch-link:text-foreground transition-colors">{branch.name}</span>
          </a>
          {renaming.suggesting && (
            <span className="inline-flex shrink-0" title="Renaming branch…" aria-label="Renaming branch">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
            </span>
          )}
          <button
            type="button"
            onClick={renaming.startRenaming}
            disabled={renaming.suggesting}
            className="cursor-pointer px-1 disabled:opacity-40 disabled:pointer-events-none"
            title={renaming.suggesting ? "Renaming…" : undefined}
          >
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
          </button>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onAbortConflict}
                  disabled={gitActions.gitDialogs.actionLoading}
                  className="flex cursor-pointer h-7 px-2 shrink-0 items-center justify-center gap-1.5 rounded-md bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {gitActions.gitDialogs.actionLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs font-medium">
                    {mergeConflict ? "Abort Merge" : "Abort Rebase"}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {mergeConflict
                  ? "Abort the merge and return to the previous state"
                  : "Abort the rebase and return to the previous state"}
              </TooltipContent>
            </Tooltip>
            <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
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

          // Build tooltip content for diff action
          let tooltipContent: ReactNode = hasPR ? "Open PR" : action.label
          let tooltipClassName = "text-xs"
          let hideArrow = false
          if (isDiff && gitActions.diffStats) {
            const { additions, deletions } = gitActions.diffStats
            tooltipClassName = diffStatsTooltipClass
            tooltipContent = <DiffStatsTooltip additions={additions} deletions={deletions} />
            hideArrow = true
          }

          return (
            <span key={action.label} className="contents">
              <Tooltip>
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
                <TooltipContent side="bottom" className={tooltipClassName} hideArrow={hideArrow}>
                  {tooltipContent}
                </TooltipContent>
              </Tooltip>
              {action.action === "rebase" && <div className="mx-1.5 h-4 w-px bg-border shrink-0" />}
            </span>
          )
        })}

        {/* Browser + Terminal buttons - opens content panel */}
        {branch.sandboxId && (
          <>
            <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
            {/* Browser icon - shows when there's an active server */}
            {hasActiveServer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      openContentPanel()
                      if (serverTab) {
                        setActiveTab(serverTab.id)
                      }
                    }}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-green-400"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Preview</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleOpenTerminal}
                  className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Terminal className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Terminal</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  )
}
