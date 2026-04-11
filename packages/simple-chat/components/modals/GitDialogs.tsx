"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2, GitMerge, GitBranch, GitPullRequest, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Message } from "@/lib/types"
import { PATHS } from "@/lib/constants"
import { type RebaseConflictState, EMPTY_CONFLICT_STATE } from "@upstream/common"

// Re-export for convenience
export type { RebaseConflictState }

// ============================================================================
// Types
// ============================================================================

export interface UseGitDialogsOptions {
  chat: Chat | null
  onAddMessage?: (message: Message) => void
}

export interface UseGitDialogsResult {
  // Dialog open states
  mergeOpen: boolean
  setMergeOpen: (open: boolean) => void
  rebaseOpen: boolean
  setRebaseOpen: (open: boolean) => void
  prOpen: boolean
  setPROpen: (open: boolean) => void

  // Branch picker state
  remoteBranches: string[]
  selectedBranch: string
  setSelectedBranch: (branch: string) => void
  branchesLoading: boolean
  actionLoading: boolean

  // Merge-specific state
  squashMerge: boolean
  setSquashMerge: (squash: boolean) => void

  // Current branch info
  branchName: string

  // Actions
  handleMerge: () => Promise<void>
  handleRebase: () => Promise<void>
  handleCreatePR: () => Promise<void>
  handleAbortConflict: () => Promise<void>

  // Conflict state
  rebaseConflict: RebaseConflictState
  checkRebaseStatus: () => Promise<void>
}

// ============================================================================
// Helper function to generate unique IDs
// ============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ============================================================================
// Shared Dialog Component
// ============================================================================

interface BaseDialogProps {
  open: boolean
  onClose: () => void
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  isMobile?: boolean
}

function BaseDialog({ open, onClose, title, icon, children, isMobile = false }: BaseDialogProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const SWIPE_THRESHOLD = 100

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const content = contentRef.current
    if (content && content.scrollTop > 0) return
    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setDragY(0)
  }, [isMobile])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !isMobile) return
    const diff = e.touches[0].clientY - startY
    if (diff > 0) setDragY(diff)
  }, [isDragging, startY, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !isMobile) return
    setIsDragging(false)
    if (dragY > SWIPE_THRESHOLD) onClose()
    setDragY(0)
  }, [isDragging, dragY, onClose, isMobile])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-lg shadow-lg",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {isMobile && (
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
          )}

          <div className={cn(
            "flex items-center justify-between border-b border-border",
            isMobile ? "px-4 py-3" : "px-4 py-3"
          )}>
            <Dialog.Title className={cn(
              "flex items-center gap-2 font-semibold",
              isMobile ? "text-lg" : "text-sm"
            )}>
              {icon}
              {title}
            </Dialog.Title>
            <Dialog.Close className={cn(
              "rounded-lg hover:bg-accent transition-colors",
              isMobile ? "p-2 -mr-2" : "p-1"
            )}>
              <X className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
            </Dialog.Close>
          </div>

          <div ref={contentRef} className={cn(
            "flex-1 overflow-y-auto",
            isMobile ? "p-4" : "p-4"
          )}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ============================================================================
// Branch Selector Component
// ============================================================================

interface BranchSelectorProps {
  value: string
  onChange: (branch: string) => void
  branches: string[]
  loading: boolean
  placeholder?: string
  isMobile?: boolean
}

function BranchSelector({ value, onChange, branches, loading, placeholder = "Select branch", isMobile = false }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)

  if (loading) {
    return (
      <div className={cn(
        "flex items-center gap-2 text-muted-foreground bg-input border border-border rounded-md",
        isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
      )}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading branches...
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
          isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
        )}
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value || placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && branches.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {branches.map((branch) => (
            <button
              key={branch}
              type="button"
              onClick={() => {
                onChange(branch)
                setOpen(false)
              }}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-accent transition-colors",
                isMobile ? "text-base" : "text-sm",
                value === branch && "bg-accent"
              )}
            >
              {branch}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Merge Dialog
// ============================================================================

interface MergeDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function MergeDialog({ open, onClose, gitDialogs, chat, isMobile = false }: MergeDialogProps) {
  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Merge Branch"
      icon={<GitMerge className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>From branch</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.branchName || "No branch"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Into branch</label>
          <BranchSelector
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={gitDialogs.squashMerge}
            onChange={(e) => gitDialogs.setSquashMerge(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>Squash commits</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await gitDialogs.handleMerge()
              onClose()
            }}
            disabled={!gitDialogs.selectedBranch || gitDialogs.actionLoading}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {gitDialogs.actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Merge
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// Rebase Dialog
// ============================================================================

interface RebaseDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function RebaseDialog({ open, onClose, gitDialogs, chat, isMobile = false }: RebaseDialogProps) {
  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Rebase Branch"
      icon={<GitBranch className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Rebase</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.branchName || "No branch"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Onto branch</label>
          <BranchSelector
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await gitDialogs.handleRebase()
              onClose()
            }}
            disabled={!gitDialogs.selectedBranch || gitDialogs.actionLoading}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {gitDialogs.actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Rebase
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// PR Dialog
// ============================================================================

interface PRDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function PRDialog({ open, onClose, gitDialogs, chat, isMobile = false }: PRDialogProps) {
  const isGitHubRepo = chat?.repo && chat.repo !== "__new__"

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Create Pull Request"
      icon={<GitPullRequest className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
        {!isGitHubRepo ? (
          <p className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>
            Pull requests require a GitHub repository. This chat is using a local repository.
          </p>
        ) : (
          <>
            <div>
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>From branch</label>
              <div className={cn(
                "bg-muted/50 rounded-md px-3 font-medium truncate",
                isMobile ? "py-3 text-base" : "py-2 text-sm"
              )}>
                {gitDialogs.branchName || "No branch"}
              </div>
            </div>

            <div>
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>Into branch</label>
              <BranchSelector
                value={gitDialogs.selectedBranch}
                onChange={gitDialogs.setSelectedBranch}
                branches={gitDialogs.remoteBranches}
                loading={gitDialogs.branchesLoading}
                isMobile={isMobile}
              />
            </div>

            <p className={cn(
              "text-muted-foreground",
              isMobile ? "text-sm" : "text-xs"
            )}>
              PR title and description will be generated from your commits.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          {isGitHubRepo && (
            <button
              onClick={async () => {
                await gitDialogs.handleCreatePR()
                onClose()
              }}
              disabled={!gitDialogs.selectedBranch || gitDialogs.actionLoading}
              className={cn(
                "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
                isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
              )}
            >
              {gitDialogs.actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create PR
            </button>
          )}
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// useGitDialogs Hook
// ============================================================================

export function useGitDialogs({ chat, onAddMessage }: UseGitDialogsOptions): UseGitDialogsResult {
  const branchName = chat?.branch ?? ""
  const baseBranch = chat?.baseBranch ?? ""
  const sandboxId = chat?.sandboxId ?? ""
  const repo = chat?.repo ?? ""

  // Parse owner/repo from repo string
  const [repoOwner, repoApiName] = repo.includes("/") ? repo.split("/") : ["", ""]

  // Dialog open states
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [prOpen, setPROpen] = useState(false)

  // Shared state for branch picker
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Merge-specific state
  const [squashMerge, setSquashMerge] = useState(false)

  // Conflict state
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>(EMPTY_CONFLICT_STATE)

  // Get repo name from repo path (owner/name -> name)
  const repoName = repoApiName || ""

  // Add system message helper for git operations
  const addSystemMessage = useCallback((content: string, isError = false) => {
    if (!onAddMessage) return
    onAddMessage({
      id: generateId(),
      role: "assistant",
      content,
      messageType: "git-operation",
      isError,
      timestamp: Date.now(),
    })
  }, [onAddMessage])

  // Fetch branches when dialog opens
  const fetchBranches = useCallback(async () => {
    if (!repoOwner || !repoApiName) {
      setRemoteBranches([])
      setSelectedBranch("")
      return
    }

    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoApiName)}`
      )
      const data = await res.json()
      const branches = (data.branches || [])
        .map((b: { name: string }) => b.name)
        .filter((name: string) => name !== branchName)
      setRemoteBranches(branches)
      setSelectedBranch(branches.includes(baseBranch) ? baseBranch : branches[0] || "")
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoApiName, branchName, baseBranch])

  // Fetch branches when dialogs open
  useEffect(() => {
    if (mergeOpen || rebaseOpen || prOpen) {
      setSelectedBranch("")
      setSquashMerge(false)
      fetchBranches()
    }
  }, [mergeOpen, rebaseOpen, prOpen, fetchBranches])

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "merge",
          targetBranch: selectedBranch,
          currentBranch: branchName,
          squash: squashMerge,
          repoOwner,
          repoApiName,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict && data.inMerge) {
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join("\n")
        addSystemMessage(
          `**Merge conflict detected**\n\n` +
          `Merging **${branchName}** into **${selectedBranch}** resulted in conflicts.\n\n` +
          `**Conflicted files:**\n${fileList}\n\n` +
          `You can ask the agent to resolve these conflicts.`
        )
        setMergeOpen(false)
        return
      }

      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Merge failed")
      }

      addSystemMessage(
        `**${squashMerge ? "Squash merged" : "Merged"}** **${branchName}** into **${selectedBranch}** and pushed.`
      )
      setMergeOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`**Merge failed:** ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, repoName, repoOwner, repoApiName, squashMerge, addSystemMessage])

  // Handle rebase
  const handleRebase = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rebase",
          targetBranch: selectedBranch,
          currentBranch: branchName,
          repoOwner,
          repoApiName,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict) {
        setRebaseConflict({
          inRebase: true,
          inMerge: false,
          conflictedFiles: data.conflictedFiles || [],
        })
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join("\n")
        addSystemMessage(
          `**Rebase conflict detected**\n\n` +
          `Rebasing **${branchName}** onto **${selectedBranch}** resulted in conflicts.\n\n` +
          `**Conflicted files:**\n${fileList}\n\n` +
          `You can ask the agent to resolve these conflicts.`
        )
        setRebaseOpen(false)
        return
      }

      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Rebase failed")
      }

      addSystemMessage(
        `**Rebased** **${branchName}** onto **${selectedBranch}**. The branch on GitHub now points at your rebased commits.`
      )
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`**Rebase failed:** ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, repoName, repoOwner, repoApiName, addSystemMessage])

  // Handle create PR
  const handleCreatePR = useCallback(async () => {
    if (!selectedBranch || !branchName || !repoOwner || !repoApiName) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          head: branchName,
          base: selectedBranch,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR")
      }

      addSystemMessage(
        `**Pull request created:** [#${data.number} - ${data.title}](${data.url})`
      )
      setPROpen(false)
    } catch (err: unknown) {
      addSystemMessage(`**PR creation failed:** ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setPROpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, repoOwner, repoApiName, addSystemMessage])

  // Handle abort conflict
  const handleAbortConflict = useCallback(async () => {
    if (!sandboxId) return
    const isMerge = rebaseConflict.inMerge
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: isMerge ? "abort-merge" : "abort-rebase",
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setRebaseConflict(EMPTY_CONFLICT_STATE)
      addSystemMessage(
        isMerge
          ? `**Merge aborted.** Your branch is back to its previous state.`
          : `**Rebase aborted.** Your branch is back to its previous state.`
      )
    } catch (err: unknown) {
      addSystemMessage(`**Abort failed:** ${err instanceof Error ? err.message : "Unknown error"}`, true)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, repoName, rebaseConflict.inMerge, addSystemMessage])

  // Check rebase status
  const checkRebaseStatus = useCallback(async () => {
    if (!sandboxId) return

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "check-rebase-status",
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setRebaseConflict({
          inRebase: data.inRebase || false,
          inMerge: data.inMerge || false,
          conflictedFiles: data.conflictedFiles || [],
        })
      }
    } catch {
      // Best-effort
    }
  }, [sandboxId, repoName])

  // Check status on mount/sandbox change
  useEffect(() => {
    if (sandboxId) {
      checkRebaseStatus()
    }
  }, [sandboxId, checkRebaseStatus])

  return {
    mergeOpen,
    setMergeOpen,
    rebaseOpen,
    setRebaseOpen,
    prOpen,
    setPROpen,
    remoteBranches,
    selectedBranch,
    setSelectedBranch,
    branchesLoading,
    actionLoading,
    squashMerge,
    setSquashMerge,
    branchName,
    handleMerge,
    handleRebase,
    handleCreatePR,
    handleAbortConflict,
    rebaseConflict,
    checkRebaseStatus,
  }
}
