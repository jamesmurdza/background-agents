import type { Chat, Message } from "@/lib/types"
import { type RebaseConflictState } from "@upstream/common"

// Re-export for convenience
export type { RebaseConflictState }

// ============================================================================
// Types for Git Dialogs
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
