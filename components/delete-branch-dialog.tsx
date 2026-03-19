"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { Branch, Repo } from "@/lib/types"
import { MERGE_STATUS, type MergeStatus } from "@/lib/constants"

// =============================================================================
// Types
// =============================================================================

interface DeleteBranchDialogProps {
  /** The branch to delete, or null if dialog should be closed */
  branch: Branch | null
  /** Repository info for checking merge status */
  repo: Repo
  /** Callback when dialog is closed (without deleting) */
  onClose: () => void
  /** Callback when branch deletion is confirmed */
  onConfirm: (branchId: string, deleteRemote: boolean) => void
}

// =============================================================================
// Merge Status Icons
// =============================================================================

function MergedIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" />
    </svg>
  )
}

// =============================================================================
// Merge Status Display Components
// =============================================================================

interface MergeStatusDisplayProps {
  status: MergeStatus
  deleteRemoteChecked: boolean
  onDeleteRemoteChange: (checked: boolean) => void
  isDeleting: boolean
}

function MergeStatusDisplay({
  status,
  deleteRemoteChecked,
  onDeleteRemoteChange,
  isDeleting,
}: MergeStatusDisplayProps) {
  if (status === MERGE_STATUS.LOADING) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Checking branch status...</span>
      </div>
    )
  }

  if (status === MERGE_STATUS.MERGED) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/50 p-3">
        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
          <MergedIcon />
          <span className="font-medium">Branch is fully merged</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={deleteRemoteChecked}
            onChange={(e) => onDeleteRemoteChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border cursor-pointer"
            disabled={isDeleting}
          />
          <span>Also delete branch on GitHub</span>
        </label>
      </div>
    )
  }

  if (status === MERGE_STATUS.UNMERGED) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary/50 p-3">
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <WarningIcon />
          <span className="font-medium">Branch has unmerged changes</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The branch will remain on GitHub. You can delete it manually from GitHub after reviewing the changes.
        </p>
      </div>
    )
  }

  // Error state
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Unable to check branch status. The branch will remain on GitHub.</span>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Dialog for confirming branch deletion with merge status check
 *
 * Features:
 * - Checks if branch exists on GitHub before showing modal
 * - Shows merge status (merged/unmerged/error)
 * - Option to delete remote branch if merged
 * - Prevents accidental deletion with confirmation
 */
export function DeleteBranchDialog({
  branch,
  repo,
  onClose,
  onConfirm,
}: DeleteBranchDialogProps) {
  const [mergeStatus, setMergeStatus] = useState<MergeStatus>(MERGE_STATUS.LOADING)
  const [deleteRemoteChecked, setDeleteRemoteChecked] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Check merge status when branch changes
  useEffect(() => {
    if (!branch) return

    setMergeStatus(MERGE_STATUS.LOADING)
    setDeleteRemoteChecked(false)

    const checkMerged = async () => {
      try {
        const baseBranch = branch.baseBranch || repo.defaultBranch || "main"
        const res = await fetch(
          `/api/github/check-merged?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}&branch=${encodeURIComponent(branch.name)}&baseBranch=${encodeURIComponent(baseBranch)}`
        )
        const data = await res.json()
        if (res.ok) {
          const isMerged = data.isMerged
          setMergeStatus(isMerged ? MERGE_STATUS.MERGED : MERGE_STATUS.UNMERGED)
          // Default to checking the delete on GitHub option if branch is merged
          if (isMerged) {
            setDeleteRemoteChecked(true)
          }
        } else {
          setMergeStatus(MERGE_STATUS.ERROR)
        }
      } catch {
        setMergeStatus(MERGE_STATUS.ERROR)
      }
    }
    checkMerged()
  }, [branch, repo.owner, repo.name, repo.defaultBranch])

  const handleConfirm = useCallback(async () => {
    if (!branch) return

    setIsDeleting(true)
    try {
      onConfirm(branch.id, deleteRemoteChecked)
    } finally {
      setIsDeleting(false)
      setDeleteRemoteChecked(false)
    }
  }, [branch, deleteRemoteChecked, onConfirm])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !isDeleting) {
      onClose()
    }
  }, [isDeleting, onClose])

  return (
    <Dialog open={!!branch} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Remove branch</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Are you sure you want to remove <span className="font-semibold text-foreground">{branch?.name}</span>? This will delete the chat history and sandbox.
          </p>

          <MergeStatusDisplay
            status={mergeStatus}
            deleteRemoteChecked={deleteRemoteChecked}
            onDeleteRemoteChange={setDeleteRemoteChecked}
            isDeleting={isDeleting}
          />
        </div>
        <DialogFooter className="gap-2">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isDeleting || mergeStatus === MERGE_STATUS.LOADING}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
            Remove
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Hook for managing delete dialog state
// =============================================================================

interface UseDeleteBranchDialogOptions {
  repo: Repo
  onRemoveBranch: (branchId: string, deleteRemote?: boolean) => Promise<void> | void
}

/**
 * Hook to manage delete branch dialog state and logic
 * Includes pre-check for whether branch exists on GitHub
 */
export function useDeleteBranchDialog({ repo, onRemoveBranch }: UseDeleteBranchDialogOptions) {
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null)
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null)

  // Handle delete button click
  // - show spinner immediately
  // - check if branch exists on GitHub
  //   - if not found, auto-delete immediately (no modal)
  //   - if found, open the modal (modal will do merge-status loading)
  const handleDeleteClick = useCallback(async (branchId: string) => {
    const branch = repo.branches.find((b) => b.id === branchId)
    if (!branch) return

    setDeletingBranchId(branchId)

    try {
      const baseBranch = branch.baseBranch || repo.defaultBranch || "main"
      const res = await fetch(
        `/api/github/check-merged?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}&branch=${encodeURIComponent(branch.name)}&baseBranch=${encodeURIComponent(baseBranch)}`
      )
      const data = await res.json()

      // If branch doesn't exist on GitHub, delete immediately without modal.
      if (res.ok && data.notFound) {
        await onRemoveBranch(branchId, false)
        setDeletingBranchId(null)
        return
      }
    } catch {
      // Fall through: if check fails, we'll show the modal.
    }

    // Branch exists (or couldn't verify): show modal.
    setDeletingBranch(branch)
    setDeletingBranchId(null)
  }, [repo, onRemoveBranch])

  const handleClose = useCallback(() => {
    setDeletingBranch(null)
    setDeletingBranchId(null)
  }, [])

  const handleConfirm = useCallback(
    async (branchId: string, deleteRemote: boolean) => {
      setDeletingBranchId(branchId)
      await onRemoveBranch(branchId, deleteRemote)
      setDeletingBranch(null)
      setDeletingBranchId(null)
    },
    [onRemoveBranch]
  )

  return {
    deletingBranch,
    deletingBranchId,
    handleDeleteClick,
    handleClose,
    handleConfirm,
  }
}
