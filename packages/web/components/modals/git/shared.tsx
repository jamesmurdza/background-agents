"use client"

import { useState, useEffect, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, ChevronDown } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { cn } from "@/lib/utils"
import type { Chat, Message } from "@/lib/types"
import { type RebaseConflictState } from "@upstream/common"

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
export type PRDescriptionTypeForHook = "short" | "long" | "commits" | "none"

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
  setRebaseConflict: (state: RebaseConflictState) => void
  checkRebaseStatus: () => Promise<void>
}

// ============================================================================
// Shared Dialog Component
// ============================================================================

export interface BaseDialogProps {
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

export function BaseDialog({ open, onClose, title, icon, children, isMobile = false, allowOverflow = false, initialFocusRef }: BaseDialogProps) {
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

export interface BranchSelectorProps {
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
  /** Default value to show while loading */
  defaultValue?: string
}

export function BranchSelector({ value, onChange, branches, loading, placeholder = "Select chat", isMobile = false, getLabel, onOpenChange, autoFocus, onSubmit, defaultValue }: BranchSelectorProps) {
  const label = (b: string) => (getLabel ? getLabel(b) : b)
  const [open, setOpenState] = useState(false)
  const [search, setSearch] = useState("")
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Use defaultValue while loading, otherwise use value
  const displayValue = value || (loading ? defaultValue : "") || ""

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
      // - ArrowDown/Space opens the dropdown (only if not loading)
      if (e.key === "Enter") {
        // Allow submit with displayValue (includes defaultValue while loading)
        if (displayValue && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
        // If no value selected and not loading, let Enter open the dropdown
        else if (!loading) {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      // Only allow opening dropdown if not loading
      if (!loading && (e.key === "ArrowDown" || e.key === " ")) {
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
          value={open ? search : (displayValue ? label(displayValue) : "")}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open && !loading) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          readOnly={loading}
        />
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin ml-2 text-muted-foreground shrink-0" />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen(!open)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {open && !loading && (
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
// Shared UI Components - Reduce duplication across dialogs
// ============================================================================

/** Responsive label for form fields */
export function DialogLabel({ children, isMobile = false }: { children: React.ReactNode; isMobile?: boolean }) {
  return (
    <label className={cn(
      "block text-muted-foreground mb-1",
      isMobile ? "text-sm" : "text-xs"
    )}>
      {children}
    </label>
  )
}

/** Readonly display field for showing current values */
export function DialogReadonlyField({ children, isMobile = false }: { children: React.ReactNode; isMobile?: boolean }) {
  return (
    <div className={cn(
      "bg-muted/50 rounded-md px-3 font-medium truncate",
      isMobile ? "py-3 text-base" : "py-2 text-sm"
    )}>
      {children}
    </div>
  )
}

/** Standard cancel button for dialogs */
export function DialogCancelButton({ onClick, isMobile = false }: { onClick: () => void; isMobile?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md hover:bg-accent transition-colors",
        isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
      )}
    >
      Cancel
    </button>
  )
}

/** Standard primary action button for dialogs */
export interface DialogActionButtonProps {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  isMobile?: boolean
  variant?: "primary" | "destructive"
  children: React.ReactNode
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}

export function DialogActionButton({
  onClick,
  disabled = false,
  loading = false,
  isMobile = false,
  variant = "primary",
  children,
  buttonRef,
}: DialogActionButtonProps) {
  const variantClasses = variant === "destructive"
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90"

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "rounded-md disabled:opacity-50 flex items-center gap-2",
        variantClasses,
        isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

/** Standard footer with cancel and action buttons */
export interface DialogFooterProps {
  onCancel: () => void
  onAction: () => void
  actionLabel: string
  disabled?: boolean
  loading?: boolean
  isMobile?: boolean
  variant?: "primary" | "destructive"
  actionButtonRef?: React.RefObject<HTMLButtonElement | null>
}

export function DialogFooter({
  onCancel,
  onAction,
  actionLabel,
  disabled = false,
  loading = false,
  isMobile = false,
  variant = "primary",
  actionButtonRef,
}: DialogFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <DialogCancelButton onClick={onCancel} isMobile={isMobile} />
      <DialogActionButton
        onClick={onAction}
        disabled={disabled}
        loading={loading}
        isMobile={isMobile}
        variant={variant}
        buttonRef={actionButtonRef}
      >
        {actionLabel}
      </DialogActionButton>
    </div>
  )
}

/** Responsive icon sizing for dialog headers */
export function dialogIconClass(isMobile: boolean): string {
  return isMobile ? "h-5 w-5" : "h-4 w-4"
}
