"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, GitMerge, GitBranch, GitPullRequest, GitCommitVertical, ChevronDown, AlertTriangle } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
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
  /** Update base branch after successful merge (only if chat has no parent chat). */
  onSetBaseBranch?: (targetBranch: string) => void
  /** Refetch messages for a chat (called after git operations add messages on backend). */
  refetchMessages?: (chatId: string) => Promise<void>
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
  forcePushOpen: boolean
  setForcePushOpen: (open: boolean) => void

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
  handleForcePush: () => Promise<void>
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
  /** Ref to the element that should receive focus when dialog opens */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

function BaseDialog({ open, onClose, title, icon, children, isMobile = false, allowOverflow = false, initialFocusRef }: BaseDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            if (initialFocusRef?.current) {
              e.preventDefault()
              initialFocusRef.current.focus()
            }
          }}
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
        >
          {/* Draggable header area */}
          <div {...dragHandlers}>
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
          </div>

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
  /** Whether to auto-focus the input */
  autoFocus?: boolean
  /** Called when Enter is pressed while dropdown is closed (to submit the form) */
  onSubmit?: () => void
}

function BranchSelector({ value, onChange, branches, loading, placeholder = "Select chat", isMobile = false, getLabel, onOpenChange, autoFocus, onSubmit }: BranchSelectorProps) {
  const label = (b: string) => (getLabel ? getLabel(b) : b)
  const [open, setOpenState] = useState(false)
  const [search, setSearch] = useState("")
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const setOpen = (newOpen: boolean) => {
    setOpenState(newOpen)
    onOpenChange?.(newOpen)
    if (newOpen) {
      setSearch("")
      setHighlightedIndex(0)
    }
  }

  // Filter branches by search
  const filteredBranches = branches.filter((branch) =>
    label(branch).toLowerCase().includes(search.toLowerCase())
  )

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const highlighted = listRef.current.querySelector('[data-highlighted="true"]')
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" })
      }
    }
  }, [highlightedIndex, open])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // When dropdown is closed:
      // - Enter submits the form (if value selected and onSubmit provided)
      // - ArrowDown/Space opens the dropdown
      if (e.key === "Enter") {
        if (value && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
        // If no value selected, let Enter open the dropdown
        else {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      if (e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    // When dropdown is open
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredBranches.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (filteredBranches[highlightedIndex]) {
          onChange(filteredBranches[highlightedIndex])
          setOpen(false)
        }
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        break
    }
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
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "w-full flex items-center bg-input border border-border rounded-md focus-within:ring-2 focus-within:ring-ring",
          isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
        )}
      >
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={open ? search : (value ? label(value) : "")}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen(!open)}
          className="ml-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredBranches.length === 0 ? (
            <div className={cn(
              "px-3 py-2 text-muted-foreground",
              isMobile ? "text-base" : "text-sm"
            )}>
              No matches found
            </div>
          ) : (
            filteredBranches.map((branch, index) => (
              <button
                key={branch}
                type="button"
                data-highlighted={index === highlightedIndex}
                onClick={() => {
                  onChange(branch)
                  setOpen(false)
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "w-full text-left px-3 py-2 transition-colors",
                  isMobile ? "text-base" : "text-sm",
                  index === highlightedIndex ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                {label(branch)}
              </button>
            ))
          )}
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

  const handleMergeAndClose = useCallback(async () => {
    await gitDialogs.handleMerge()
    onClose()
  }, [gitDialogs, onClose])

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
            autoFocus
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
            onSubmit={handleMergeAndClose}
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
            onClick={handleMergeAndClose}
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

  const handleRebaseAndClose = useCallback(async () => {
    await gitDialogs.handleRebase()
    onClose()
  }, [gitDialogs, onClose])

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
            autoFocus
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
            onSubmit={handleRebaseAndClose}
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
            onClick={handleRebaseAndClose}
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

  const handleCreatePRAndClose = useCallback(async () => {
    await gitDialogs.handleCreatePR(descriptionType)
    onClose()
  }, [gitDialogs, descriptionType, onClose])

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
                autoFocus
                value={gitDialogs.selectedBranch}
                onChange={gitDialogs.setSelectedBranch}
                branches={gitDialogs.remoteBranches}
                loading={gitDialogs.branchesLoading}
                isMobile={isMobile}
                onOpenChange={setBranchDropdownOpen}
                onSubmit={handleCreatePRAndClose}
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
              onClick={handleCreatePRAndClose}
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
  const squashButtonRef = useRef<HTMLButtonElement>(null)

  const handleSquashAndClose = useCallback(async () => {
    await gitDialogs.handleSquash()
    onClose()
  }, [gitDialogs, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Squash Commits"
      icon={<GitCommitVertical className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
      initialFocusRef={squashButtonRef}
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
            ref={squashButtonRef}
            onClick={handleSquashAndClose}
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
// Force Push Dialog
// ============================================================================

interface ForcePushDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function ForcePushDialog({ open, onClose, gitDialogs, chat, isMobile = false }: ForcePushDialogProps) {
  const agentRunning = chat?.status === "running"
  const branchLabel = gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : ""
  const forcePushButtonRef = useRef<HTMLButtonElement>(null)

  const handleForcePush = useCallback(async () => {
    await gitDialogs.handleForcePush()
  }, [gitDialogs])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Force push"
      icon={<AlertTriangle className={cn(isMobile ? "h-5 w-5" : "h-4 w-4", "text-amber-500")} />}
      isMobile={isMobile}
      initialFocusRef={forcePushButtonRef}
    >
      <div className={cn("space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Branch</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {branchLabel || "No chat"}
          </div>
        </div>

        <p className={cn(
          "text-muted-foreground",
          isMobile ? "text-base" : "text-sm"
        )}>
          This will overwrite the remote history of{" "}
          <span className="font-semibold text-foreground">{branchLabel}</span>{" "}
          with your local commits. Anyone with the old history will need to re-sync.
        </p>

        {agentRunning && (
          <p className={cn(
            "text-amber-500",
            isMobile ? "text-sm" : "text-xs"
          )}>
            The agent is running on this branch. Wait for it to finish before force pushing.
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
            ref={forcePushButtonRef}
            onClick={handleForcePush}
            disabled={agentRunning || gitDialogs.actionLoading || !gitDialogs.branchName}
            className={cn(
              "rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {gitDialogs.actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Force push
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// useGitDialogs Hook
// ============================================================================

export function useGitDialogs({ chat, onAddMessageToBranch, resolveChatName, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync, onSetBaseBranch, refetchMessages }: UseGitDialogsOptions): UseGitDialogsResult {
  const chatId = chat?.id ?? ""
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
  const [forcePushOpen, setForcePushOpen] = useState(false)

  // Shared state for branch picker
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranchState] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Track pre-selected branch from drag-and-drop. This ref is set when
  // setSelectedBranch is called before the dialog opens, and consumed
  // when fetchBranches runs.
  const pendingSelectedBranchRef = useRef<string | null>(null)
  const setSelectedBranch = useCallback((branch: string) => {
    // If a dialog is already open, just set the state directly
    if (mergeOpen || rebaseOpen || prOpen) {
      setSelectedBranchState(branch)
    } else {
      // Store in ref to be consumed when the dialog opens and branches are fetched
      pendingSelectedBranchRef.current = branch
      setSelectedBranchState(branch)
    }
  }, [mergeOpen, rebaseOpen, prOpen])

  // Merge-specific state
  const [squashMerge, setSquashMerge] = useState(false)

  // Squash-specific state
  const [commitsAhead, setCommitsAhead] = useState(0)
  const [commitsLoading, setCommitsLoading] = useState(false)

  // Conflict state
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>(EMPTY_CONFLICT_STATE)

  // Always use "project" as the directory name - sandbox/create always uses this
  const repoName = "project"

  // Fetch branches when dialog opens
  const fetchBranches = useCallback(async () => {
    if (!repoOwner || !repoApiName) {
      setRemoteBranches([])
      setSelectedBranchState("")
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
      // Use pending branch from drag-and-drop if valid, otherwise fall back to baseBranch
      const pendingBranch = pendingSelectedBranchRef.current
      pendingSelectedBranchRef.current = null // Consume the pending value
      const defaultBranch = pendingBranch && branches.includes(pendingBranch)
        ? pendingBranch
        : branches.includes(baseBranch)
          ? baseBranch
          : branches[0] || ""
      setSelectedBranchState(defaultBranch)
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoApiName, branchName, baseBranch])

  // Fetch branches when dialogs open
  useEffect(() => {
    if (mergeOpen || rebaseOpen || prOpen) {
      setSquashMerge(false)
      fetchBranches()
    }
  }, [mergeOpen, rebaseOpen, prOpen, fetchBranches])

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId || !chatId) return

    // Block merge into a running branch (frontend check only - backend creates the message)
    const targetStatus = getTargetChatStatus?.(selectedBranch)
    if (targetStatus === "running") {
      // The API will create the error message
      setMergeOpen(false)
      return
    }

    setActionLoading(true)

    // Get the target sandbox ID so we can pull the merged changes there
    const targetSandboxId = getTargetSandboxId?.(selectedBranch) ?? null
    console.log(`[merge] selectedBranch: ${selectedBranch}, targetSandboxId: ${targetSandboxId}`)

    // Resolve names for the success message
    const sourceName = chat?.displayName || branchName
    const targetName = resolveChatName?.(selectedBranch) || selectedBranch

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
          chatId,
          sourceName,
          targetName,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict && data.inMerge) {
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })
        // Message is created by the backend - refetch to show it
        await refetchMessages?.(chatId)
        setMergeOpen(false)
        return
      }

      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setMergeOpen(false)
        return
      }

      // If sandbox was stopped, mark branch for sync on next wake
      if (data.needsSync && onMarkBranchNeedsSync) {
        onMarkBranchNeedsSync(selectedBranch)
      }

      // If this chat has no parent chat, update base branch to the merge target
      if (!chat?.parentChatId && onSetBaseBranch) {
        onSetBaseBranch(selectedBranch)
      }

      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setMergeOpen(false)
    } catch {
      // Error message may have been created by backend on API error - refetch to show it
      await refetchMessages?.(chatId)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, squashMerge, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync, chat?.parentChatId, chat?.displayName, onSetBaseBranch, resolveChatName, refetchMessages])

  // Handle rebase
  const handleRebase = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId || !chatId) return
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
          chatId,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict) {
        setRebaseConflict({
          inRebase: true,
          inMerge: false,
          conflictedFiles: data.conflictedFiles || [],
        })
        // Message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setRebaseOpen(false)
        return
      }

      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setRebaseOpen(false)
        return
      }

      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setRebaseOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle create PR
  const handleCreatePR = useCallback(async (descriptionType: PRDescriptionTypeForHook = "short") => {
    if (!selectedBranch || !branchName || !repoOwner || !repoApiName || !chatId) return
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
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setPROpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setPROpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, repoOwner, repoApiName, chatId, refetchMessages])

  // Handle force push (temp-branch dance: push commits to a throwaway remote
  // branch so GitHub has the objects, then PATCH the real branch ref to that SHA).
  const handleForcePush = useCallback(async () => {
    if (!branchName || !sandboxId || !repoOwner || !repoApiName || !chatId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "force-push",
          currentBranch: branchName,
          repoOwner,
          repoApiName,
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setForcePushOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setForcePushOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle abort conflict
  const handleAbortConflict = useCallback(async () => {
    if (!sandboxId || !chatId) return
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
          chatId,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        return
      }

      setRebaseConflict(EMPTY_CONFLICT_STATE)
      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, chatId, repoName, rebaseConflict.inMerge, refetchMessages])

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
    if (!branchName || !sandboxId || !chatId || commitsAhead < 2) return
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
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setSquashOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setSquashOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [branchName, sandboxId, chatId, commitsAhead, baseBranch, repoOwner, repoApiName, refetchMessages])

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
    forcePushOpen,
    setForcePushOpen,
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
    handleForcePush,
    handleAbortConflict,
    rebaseConflict,
    checkRebaseStatus,
  }
}
