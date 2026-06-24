import type { Chat } from "@/lib/types"
import { type RebaseConflictState } from "@background-agents/common"

// Re-export for convenience
export type { RebaseConflictState }

// ============================================================================
// Types for Git Dialogs
// ============================================================================

export interface UseGitDialogsOptions {
  /** The chat the dialogs are operating on (the source side of merge/rebase/PR). */
  chat: Chat | null
  /**
   * The full chat list. The hook uses it to find the *target* chat for a
   * branch in the same repo — to resolve display names, pull the target
   * sandbox ID after a merge, check the target's status, and mark it
   * needs-sync when the target sandbox is stopped.
   */
  chats: Chat[]
  /**
   * Persist a chat update. The hook uses this to mark the target branch's
   * chat as needing sync after a merge, and to advance the *source* chat's
   * base branch after merging into a new base.
   */
  updateChatById: (chatId: string, updates: Partial<Chat>) => Promise<void> | void
  /** Refetch messages for a chat (called after git operations add messages on backend). */
  refetchMessages?: (chatId: string) => Promise<void>
  /**
   * Register a listener for conflict-state updates coming in via SSE
   * (the agent emits these when it resolves a rebase conflict). Passing
   * null clears the listener. The hook wires this to its own
   * setRebaseConflict so the warning icon updates live.
   */
  setOnConflictStateChange?: (
    callback: ((state: RebaseConflictState) => void) | null
  ) => void
}

/** PR description format options */
export type PRDescriptionType = "short" | "long" | "commits" | "none"

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
  handleCreatePR: (descriptionType?: PRDescriptionType) => Promise<void>
  handleSquash: () => Promise<void>
  handleForcePush: () => Promise<void>
  handleAbortConflict: () => Promise<void>

  // Conflict state
  rebaseConflict: RebaseConflictState
  setRebaseConflict: (state: RebaseConflictState) => void
  checkRebaseStatus: () => Promise<void>
}

/** Common props for all git dialog components */
export interface GitDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}
