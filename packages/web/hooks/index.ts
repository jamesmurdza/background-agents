// Re-export all hooks for easy importing
export { useRepoData } from "./use-repo-data"
export type { RepoData } from "./use-repo-data"

export { useBranchSelection } from "./use-branch-selection"
export type { BranchSelection } from "./use-branch-selection"

export { useRepoNavigation } from "./use-repo-navigation"
export type { RepoNavigation } from "./use-repo-navigation"

export { useRepoOperations } from "./use-repo-operations"
export type { RepoOperations } from "./use-repo-operations"

export { useBranchOperations } from "./use-branch-operations"
export type { BranchOperations } from "./use-branch-operations"

export { useMobileHandlers } from "./use-mobile-handlers"
export type { MobileHandlers } from "./use-mobile-handlers"

export { useSyncData } from "./use-sync-data"
export type { SyncDataHandler, SyncData, SyncRepo, SyncBranch } from "./use-sync-data"

// Existing hooks
export { useCrossDeviceSync } from "./use-cross-device-sync"
export { useIsMobile } from "./use-mobile"

// Execution polling
export { isBranchPolling } from "./use-execution-poller"
export { useExecutionManager } from "./use-execution-manager"

// Re-export accessibility hooks from @upstream/common
export {
  useKeyboardNavigation,
  useFocusTrap,
  useRovingTabIndex,
  focusRing,
  focusRingInset,
  focusRingSubtle,
  focusRingDark,
  focusStyles,
} from "@upstream/common"
export type {
  UseKeyboardNavigationOptions,
  UseKeyboardNavigationReturn,
  UseFocusTrapOptions,
  UseRovingTabIndexOptions,
  UseRovingTabIndexReturn,
  FocusStyleType,
} from "@upstream/common"
