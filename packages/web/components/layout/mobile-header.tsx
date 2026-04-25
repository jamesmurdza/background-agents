"use client"

import { cn } from "@/lib/shared/utils"
import type { Branch, UserCredentialFlags } from "@/lib/shared/types"
import { BRANCH_STATUS, PATHS } from "@/lib/shared/constants"
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
  Pencil,
  Check,
  X,
  Sparkles,
  AlertTriangle,
  XCircle,
} from "lucide-react"
import type { RebaseConflictState } from "@/components/git/hooks/useGitDialogs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCallback, useEffect, useRef, useState } from "react"

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
  gitHistoryOpen: boolean
  sandboxToggleLoading: boolean
  prLoading: boolean
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  credentials?: UserCredentialFlags | null
  rebaseConflict?: RebaseConflictState
  onAbortConflict?: () => void
  abortLoading?: boolean
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
  gitHistoryOpen,
  sandboxToggleLoading,
  prLoading,
  onUpdateBranch,
  credentials,
  rebaseConflict,
  onAbortConflict,
  abortLoading,
}: MobileHeaderProps) {
  const isStopped = branch?.status === BRANCH_STATUS.STOPPED
  const isRunning = branch?.status === BRANCH_STATUS.RUNNING || branch?.status === BRANCH_STATUS.CREATING
  const hasPR = !!branch?.prUrl
  const hasSandbox = !!branch?.sandboxId
  const showMenu = !!(repoOwner && repoName && branch)
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)
  const mergeConflict = rebaseConflict?.inMerge ?? false

  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const canSuggestName = !!(
    credentials?.ANTHROPIC_API_KEY ||
    credentials?.OPENAI_API_KEY ||
    credentials?.hasServerLlmFallback
  )
  const canRename = !!branch?.sandboxId && !isRunning

  useEffect(() => {
    // If branch changes while renaming, cancel so we don't rename the wrong one.
    setRenaming(false)
    setRenameValue("")
    setRenameError(null)
    setRenameLoading(false)
    setSuggesting(false)
  }, [branch?.id])

  const startRenaming = useCallback(() => {
    if (!branch || !canRename || renameLoading || suggesting) return
    setRenaming(true)
    setRenameValue(branch.name)
    setRenameError(null)
    setSuggesting(false)
  }, [branch, canRename, renameLoading, suggesting])

  const cancelRenaming = useCallback(() => {
    if (renameLoading) return
    setRenaming(false)
    setRenameValue("")
    setRenameError(null)
    setSuggesting(false)
  }, [renameLoading])

  const suggestBranchName = useCallback(async () => {
    if (!branch || !canRename || renameLoading || suggesting) return
    if (branch.messages.length === 0) return

    setSuggesting(true)
    setRenaming(true)
    setRenameError(null)
    setRenameValue("loading...")

    try {
      const res = await fetch("/api/branches/suggest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: branch.id }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          (data as { error?: string; message?: string }).error ||
            (data as { error?: string; message?: string }).message ||
            "Failed to generate suggestion",
        )
      }

      const suggestedName = (data as { suggestedName?: string }).suggestedName
      if (!suggestedName) throw new Error("Suggestion missing suggestedName")

      setRenameValue(suggestedName)
      requestAnimationFrame(() => {
        const input = renameInputRef.current
        if (input) {
          input.focus()
          const len = suggestedName.length
          input.setSelectionRange(len, len)
        }
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Suggestion failed"
      setRenameError(message)
      setRenameValue(branch.name)
      requestAnimationFrame(() => {
        const input = renameInputRef.current
        if (input) {
          input.focus()
          const len = branch.name.length
          input.setSelectionRange(len, len)
        }
      })
    } finally {
      setSuggesting(false)
    }
  }, [branch, canRename, renameLoading, suggesting])

  const submitRenaming = useCallback(async () => {
    if (!branch || !repoOwner || !repoName || !branch.sandboxId) return
    if (!canRename || renameLoading || suggesting) return

    const newName = renameValue.trim()
    if (!newName || newName === branch.name) return

    setRenameLoading(true)
    setRenameError(null)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rename-branch",
          currentBranch: branch.name,
          newBranchName: newName,
          repoOwner,
          repoApiName: repoName,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string; message?: string }).error || (data as { error?: string; message?: string }).message || `Rename failed (${res.status})`)
      }

      onUpdateBranch(branch.id, { name: newName })
      setRenaming(false)
      setRenameValue("")
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : "Failed to rename branch")
    } finally {
      setRenameLoading(false)
    }
  }, [branch, repoOwner, repoName, canRename, renameLoading, suggesting, renameValue, onUpdateBranch])

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-2 py-2",
        inConflict
          ? "border-b-red-700 bg-red-700/12 dark:border-b-red-600 dark:bg-red-950/45"
          : "border-border bg-card"
      )}
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
                {renaming ? (
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            submitRenaming()
                          }
                          if (e.key === "Escape") {
                            e.preventDefault()
                            cancelRenaming()
                          }
                        }}
                        autoFocus
                        disabled={renameLoading || suggesting}
                        className="h-7 bg-transparent border border-border/30 rounded px-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-border/60 disabled:text-muted-foreground min-w-[6ch]"
                      />
                      {renameLoading || suggesting ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              submitRenaming()
                            }}
                          disabled={!renameValue.trim() || suggesting}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              cancelRenaming()
                            }}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                    {renameError && (
                      <span className="mt-1 text-[10px] text-red-400 ml-1.5 truncate max-w-[16rem]">
                        {renameError}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground truncate font-mono">
                      {branch.name}
                    </span>
                    {canRename && (
                      <>
                        <button
                          type="button"
                          onClick={startRenaming}
                          disabled={renameLoading || suggesting}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                          title="Rename branch"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {canSuggestName && branch.messages.length > 0 && (
                          <button
                            type="button"
                            onClick={suggestBranchName}
                            disabled={renameLoading || suggesting}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                            title="Magic rename"
                          >
                            {suggesting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
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
        {/* Conflict indicator and abort button */}
        {inConflict && (
          <>
            <div className="flex items-center gap-1 text-muted-foreground mr-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Conflict</span>
            </div>
            <button
              onClick={onAbortConflict}
              disabled={abortLoading}
              className="flex h-8 px-2 items-center justify-center gap-1 rounded-md bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed mr-1"
            >
              {abortLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              <span className="text-xs font-medium">
                {mergeConflict ? "Abort merge" : "Abort rebase"}
              </span>
            </button>
          </>
        )}

        {showMenu && (
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
              <DropdownMenuItem asChild className="cursor-pointer">
                <a
                  href={`https://github.com/${repoOwner}/${repoName}/tree/${branch!.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  Open on GitHub
                </a>
              </DropdownMenuItem>

              {hasSandbox && (
                <>
                  <DropdownMenuSeparator />

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

                  {/* Hide PR, Merge, Rebase during conflict */}
                  {!inConflict && (
                    <>
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
                    </>
                  )}

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

                  {/* Hide Merge/Rebase during conflict */}
                  {!inConflict && (
                    <>
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
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
