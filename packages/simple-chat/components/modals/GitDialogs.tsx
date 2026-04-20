"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, GitMerge, GitBranch, GitPullRequest, GitCommitVertical, ChevronDown } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
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
  /** When merging into a branch, the parent can route a mirrored system
   *  message to whichever chat owns that branch in the same repo. */
  onAddMessageToBranch?: (branch: string, message: Message) => void
  /** Resolve a branch name to a chat display name for friendlier messages. */
  resolveChatName?: (branch: string) => string | null
  /** Get the sandbox ID for a target branch (used to pull changes after merge). */
  getTargetSandboxId?: (branch: string) => string | null
  /** Get the status of a target branch (used to block merge into running branch). */
  getTargetChatStatus?: (branch: string) => string | null
  /** Mark a branch as needing sync (used when merge succeeds but sandbox was stopped). */
  onMarkBranchNeedsSync?: (branch: string) => void
}

/** PR description format options */
type PRDescriptionTypeForHook = "short" | "long" | "commits" | "none"

export interface UseGitDialogsResult {
  // Dialog open states
  mergeOpen: boolean
  setMergeOpen: (open: boolean) => void
  rebaseOpen: boolean
  setRebaseOpen: (open: boolean) => void
  prOpen: boolean
  setPROpen: (open: boolean) => void
  squashOpen: boolean
  setSquashOpen: (open: boolean) => void

  // Branch picker state
  remoteBranches: string[]
  selectedBranch: string
  setSelectedBranch: (branch: string) => void
  branchesLoading: boolean
  actionLoading: boolean

  // Merge-specific state
  squashMerge: boolean
  setSquashMerge: (squash: boolean) => void

  // Squash-specific state
  commitsAhead: number
  commitsLoading: boolean
  baseBranch: string

  // Current branch info
  branchName: string
  /** Resolve a branch → chat display name, for use in the dialog UI. */
  branchLabel: (branch: string) => string

  // Actions
  handleMerge: () => Promise<void>
  handleRebase: () => Promise<void>
  handleCreatePR: (descriptionType?: PRDescriptionTypeForHook) => Promise<void>
  handleSquash: () => Promise<void>
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
  /** When true, content area allows overflow (for dropdowns) */
  allowOverflow?: boolean
}

function BaseDialog({ open, onClose, title, icon, children, isMobile = false, allowOverflow = false }: BaseDialogProps) {
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]" />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col",
            // Allow overflow when dropdowns are open so they're not clipped
            allowOverflow ? "overflow-visible" : "overflow-hidden",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-lg shadow-xl",
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

          <ModalHeader
            title={
              <>
                {icon}
                {title}
              </>
            }
          />

          <div ref={contentRef} className={cn(
            "flex-1",
            isMobile ? "p-4" : "p-4",
            // Allow overflow when dropdowns are open so they're not clipped
            allowOverflow ? "overflow-visible" : "overflow-y-auto"
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
  /** Transform a branch name into a display label (e.g. resolve to chat name). */
  getLabel?: (branch: string) => string
  /** Called when dropdown open state changes */
  onOpenChange?: (open: boolean) => void
}

function BranchSelector({ value, onChange, branches, loading, placeholder = "Select chat", isMobile = false, getLabel, onOpenChange }: BranchSelectorProps) {
  const label = (b: string) => (getLabel ? getLabel(b) : b)
  const [open, setOpenState] = useState(false)

  const setOpen = (newOpen: boolean) => {
    setOpenState(newOpen)
    onOpenChange?.(newOpen)
  }

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
          {value ? label(value) : placeholder}
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
              {label(branch)}
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
  const [dropdownOpen, setDropdownOpen] = useState(false)

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Merge Branch"
      icon={<GitMerge className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
      allowOverflow={dropdownOpen}
    >
      <div className={cn("space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>From chat</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Into chat</label>
          <BranchSelector
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
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
  const [dropdownOpen, setDropdownOpen] = useState(false)

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Rebase Branch"
      icon={<GitBranch className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
      allowOverflow={dropdownOpen}
    >
      <div className={cn("space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Rebase</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
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
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
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

/** PR description format options */
const PR_DESCRIPTION_TYPES = ["short", "long", "commits", "none"] as const
type PRDescriptionType = typeof PR_DESCRIPTION_TYPES[number]

const DESCRIPTION_TYPE_LABELS: Record<PRDescriptionType, { label: string; description: string }> = {
  short: { label: "Short description", description: "AI-generated summary" },
  long: { label: "Long description", description: "AI-generated detailed description" },
  commits: { label: "List of commits", description: "Simple commit list (no AI)" },
  none: { label: "No description", description: "Empty description" },
}

interface PRDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function PRDialog({ open, onClose, gitDialogs, chat, isMobile = false }: PRDialogProps) {
  const isGitHubRepo = chat?.repo && chat.repo !== "__new__"
  const [descriptionType, setDescriptionType] = useState<PRDescriptionType>("short")
  const [descriptionDropdownOpen, setDescriptionDropdownOpen] = useState(false)
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Create Pull Request"
      icon={<GitPullRequest className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
      allowOverflow={descriptionDropdownOpen || branchDropdownOpen}
    >
      <div className={cn("space-y-5")}>
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
              )}>From chat</label>
              <div className={cn(
                "bg-muted/50 rounded-md px-3 font-medium truncate",
                isMobile ? "py-3 text-base" : "py-2 text-sm"
              )}>
                {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
              </div>
            </div>

            <div>
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>Into chat</label>
              <BranchSelector
                value={gitDialogs.selectedBranch}
                onChange={gitDialogs.setSelectedBranch}
                branches={gitDialogs.remoteBranches}
                loading={gitDialogs.branchesLoading}
                isMobile={isMobile}
                onOpenChange={setBranchDropdownOpen}
              />
            </div>

            {/* Description type selector */}
            <div>
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>Description format</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDescriptionDropdownOpen(!descriptionDropdownOpen)}
                  className={cn(
                    "w-full flex items-center justify-between bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
                    isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
                  )}
                >
                  <span className="text-foreground">
                    {DESCRIPTION_TYPE_LABELS[descriptionType].label}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", descriptionDropdownOpen && "rotate-180")} />
                </button>

                {descriptionDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {PR_DESCRIPTION_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setDescriptionType(type)
                          setDescriptionDropdownOpen(false)
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 hover:bg-accent transition-colors",
                          isMobile ? "text-base" : "text-sm",
                          descriptionType === type && "bg-accent"
                        )}
                      >
                        {DESCRIPTION_TYPE_LABELS[type].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className={cn(
                "text-muted-foreground mt-1",
                isMobile ? "text-sm" : "text-xs"
              )}>
                {DESCRIPTION_TYPE_LABELS[descriptionType].description}
              </p>
            </div>
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
                await gitDialogs.handleCreatePR(descriptionType)
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
// Squash Dialog
// ============================================================================

interface SquashDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function SquashDialog({ open, onClose, gitDialogs, chat, isMobile = false }: SquashDialogProps) {
  const canSquash = gitDialogs.commitsAhead >= 2 && !gitDialogs.commitsLoading

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Squash Commits"
      icon={<GitCommitVertical className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Current branch</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Base branch</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {gitDialogs.baseBranch || "main"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Commits to squash</label>
          {gitDialogs.commitsLoading ? (
            <div className={cn(
              "flex items-center gap-2 text-muted-foreground",
              isMobile ? "py-3 text-base" : "py-2 text-sm"
            )}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Counting commits...
            </div>
          ) : (
            <div className={cn(
              "bg-muted/50 rounded-md px-3 font-medium",
              isMobile ? "py-3 text-base" : "py-2 text-sm"
            )}>
              {gitDialogs.commitsAhead} commit{gitDialogs.commitsAhead !== 1 ? "s" : ""} ahead of {gitDialogs.baseBranch || "main"}
            </div>
          )}
        </div>

        {!gitDialogs.commitsLoading && gitDialogs.commitsAhead < 2 && (
          <p className={cn(
            "text-amber-500",
            isMobile ? "text-sm" : "text-xs"
          )}>
            Need at least 2 commits to squash.
          </p>
        )}

        {canSquash && (
          <p className={cn(
            "text-muted-foreground",
            isMobile ? "text-sm" : "text-xs"
          )}>
            This will combine all {gitDialogs.commitsAhead} commits into a single commit.
          </p>
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
          <button
            onClick={async () => {
              await gitDialogs.handleSquash()
              onClose()
            }}
            disabled={!canSquash || gitDialogs.actionLoading}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {gitDialogs.actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Squash
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// useGitDialogs Hook
// ============================================================================

export function useGitDialogs({ chat, onAddMessage, onAddMessageToBranch, resolveChatName, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync }: UseGitDialogsOptions): UseGitDialogsResult {
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
  const [squashOpen, setSquashOpen] = useState(false)

  // Shared state for branch picker
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Merge-specific state
  const [squashMerge, setSquashMerge] = useState(false)

  // Squash-specific state
  const [commitsAhead, setCommitsAhead] = useState(0)
  const [commitsLoading, setCommitsLoading] = useState(false)

  // Conflict state
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>(EMPTY_CONFLICT_STATE)

  // Always use "project" as the directory name - sandbox/create always uses this
  const repoName = "project"

  // Add system message helper for git operations
  const addSystemMessage = useCallback((content: string, isError = false, linkBranch?: string) => {
    if (!onAddMessage) return
    onAddMessage({
      id: generateId(),
      role: "assistant",
      content,
      messageType: "git-operation",
      isError,
      timestamp: Date.now(),
      linkBranch,
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

    // Block merge into a running branch
    const targetStatus = getTargetChatStatus?.(selectedBranch)
    if (targetStatus === "running") {
      addSystemMessage(`Cannot merge into "${selectedBranch}" while an agent is running on it.`, true)
      setMergeOpen(false)
      return
    }

    setActionLoading(true)

    // Get the target sandbox ID so we can pull the merged changes there
    const targetSandboxId = getTargetSandboxId?.(selectedBranch) ?? null
    console.log(`[merge] selectedBranch: ${selectedBranch}, targetSandboxId: ${targetSandboxId}`)

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
          targetSandboxId,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict && data.inMerge) {
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })
        const fileList = (data.conflictedFiles || []).join(", ")
        addSystemMessage(
          `Merge conflict: ${branchName} into ${selectedBranch}. Conflicted files: ${fileList}`
        )
        setMergeOpen(false)
        return
      }

      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Merge failed")
      }

      // If sandbox was stopped, mark branch for sync on next wake
      if (data.needsSync && onMarkBranchNeedsSync) {
        onMarkBranchNeedsSync(selectedBranch)
      }

      const verb = squashMerge ? "Squash merged" : "Merged"
      const sourceName = chat?.displayName || branchName
      const targetName = resolveChatName?.(selectedBranch) || selectedBranch
      const summary = `${verb} ${sourceName} into ${targetName}.`
      addSystemMessage(summary, false, selectedBranch)
      // Mirror the message to whichever chat is tracking the merged-into
      // branch so both sides see the history.
      if (onAddMessageToBranch) {
        onAddMessageToBranch(selectedBranch, {
          id: generateId(),
          role: "assistant",
          content: summary,
          messageType: "git-operation",
          timestamp: Date.now(),
          linkBranch: selectedBranch,
        })
      }
      setMergeOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, repoName, repoOwner, repoApiName, squashMerge, addSystemMessage, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync])

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
        const fileList = (data.conflictedFiles || []).join(", ")
        addSystemMessage(
          `Rebase conflict: ${branchName} onto ${selectedBranch}. Conflicted files: ${fileList}`
        )
        setRebaseOpen(false)
        return
      }

      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Rebase failed")
      }

      addSystemMessage(
        `Rebased ${branchName} onto ${selectedBranch}. The branch on GitHub now points at your rebased commits.`
      )
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, repoName, repoOwner, repoApiName, addSystemMessage])

  // Handle create PR
  const handleCreatePR = useCallback(async (descriptionType: PRDescriptionTypeForHook = "short") => {
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
          descriptionType,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR")
      }

      addSystemMessage(
        `Pull request created: #${data.number} - ${data.title} (${data.url})`
      )
      setPROpen(false)
    } catch (err: unknown) {
      addSystemMessage(`PR creation failed: ${err instanceof Error ? err.message : "Unknown error"}`, true)
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
          ? `Merge aborted. Your branch is back to its previous state.`
          : `Rebase aborted. Your branch is back to its previous state.`
      )
    } catch (err: unknown) {
      addSystemMessage(`Abort failed: ${err instanceof Error ? err.message : "Unknown error"}`, true)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, repoName, rebaseConflict.inMerge, addSystemMessage])

  // Fetch commits ahead when squash dialog opens
  const fetchCommitsAhead = useCallback(async () => {
    if (!repoOwner || !repoApiName || !baseBranch || !branchName) {
      setCommitsAhead(0)
      return
    }
    setCommitsLoading(true)
    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          base: baseBranch,
          head: branchName,
        }),
      })
      const data = await res.json()
      if (res.ok && typeof data.ahead_by === "number") {
        setCommitsAhead(data.ahead_by)
      } else {
        setCommitsAhead(0)
      }
    } catch {
      setCommitsAhead(0)
    } finally {
      setCommitsLoading(false)
    }
  }, [repoOwner, repoApiName, baseBranch, branchName])

  // Fetch commits ahead when squash dialog opens
  useEffect(() => {
    if (squashOpen) {
      fetchCommitsAhead()
    }
  }, [squashOpen, fetchCommitsAhead])

  // Handle squash
  const handleSquash = useCallback(async () => {
    if (!branchName || !sandboxId || commitsAhead < 2) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/github/squash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          head: branchName,
          base: baseBranch,
          sandboxId,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Squash failed")

      addSystemMessage(
        `Squashed ${commitsAhead} commits into one on ${branchName}.`
      )
      setSquashOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Squash failed: ${err instanceof Error ? err.message : "Unknown error"}`, true)
      setSquashOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [branchName, sandboxId, commitsAhead, baseBranch, repoOwner, repoApiName, addSystemMessage])

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
    squashOpen,
    setSquashOpen,
    remoteBranches,
    selectedBranch,
    setSelectedBranch,
    branchesLoading,
    actionLoading,
    squashMerge,
    setSquashMerge,
    commitsAhead,
    commitsLoading,
    baseBranch,
    branchName,
    branchLabel: (branch: string) => resolveChatName?.(branch) || branch,
    handleMerge,
    handleRebase,
    handleCreatePR,
    handleSquash,
    handleAbortConflict,
    rebaseConflict,
    checkRebaseStatus,
  }
}
