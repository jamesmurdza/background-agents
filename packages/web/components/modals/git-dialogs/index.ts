// Git dialogs - split into separate files for maintainability
export { MergeDialog } from "./MergeDialog"
export { RebaseDialog } from "./RebaseDialog"
export { PRDialog } from "./PRDialog"
export { SquashDialog } from "./SquashDialog"
export { GitBranchDialog, type GitBranchDialogConfig } from "./GitBranchDialog"
export { useGitDialogs } from "./useGitDialogs"
export type {
  UseGitDialogsOptions,
  UseGitDialogsResult,
  GitDialogProps,
  PRDescriptionType,
  RebaseConflictState,
} from "./types"
