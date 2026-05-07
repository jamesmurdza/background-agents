// Re-export from new modular location for backward compatibility
export {
  MergeDialog,
  RebaseDialog,
  PRDialog,
  SquashDialog,
  ForcePushDialog,
  useGitDialogs,
} from "./git-dialogs"
export type {
  UseGitDialogsOptions,
  UseGitDialogsResult,
  GitDialogProps,
  PRDescriptionType,
  RebaseConflictState,
} from "./git-dialogs"
