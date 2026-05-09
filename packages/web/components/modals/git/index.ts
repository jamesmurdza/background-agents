// Git Dialogs - Re-exports for backwards compatibility
// This module was split from a single 1400+ line file into smaller, focused components

// Types and shared components
export type {
  UseGitDialogsOptions,
  UseGitDialogsResult,
  PRDescriptionTypeForHook,
  RebaseConflictState,
} from "./shared"

// Dialog components
export { MergeDialog } from "./MergeDialog"
export { RebaseDialog } from "./RebaseDialog"
export { PRDialog } from "./PRDialog"
export { SquashDialog } from "./SquashDialog"
export { ForcePushDialog } from "./ForcePushDialog"

// Hook
export { useGitDialogs } from "./useGitDialogs"
