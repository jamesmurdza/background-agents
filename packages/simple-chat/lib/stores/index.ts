/**
 * Zustand Stores
 *
 * Export all store-related functionality from a single entry point.
 */

// UI Store (client-side UI state)
export {
  useUIStore,
  // Selector hooks
  useCurrentChatId,
  useSidebarCollapsed,
  useSidebarWidth,
  useMobileSidebarOpen,
  useRepoFilter,
  useCurrentPreviewItem,
  useCurrentQueuedMessages,
  useCurrentQueuePaused,
  useChatUnseen,
  useUnseenChatIds,
  useDeletingChatIds,
  useIsHydrated,
  // Constants
  ALL_REPOSITORIES,
  NO_REPOSITORY,
  // Types
  type PreviewItem,
  type PendingMessage,
} from "./ui-store"

// Stream Store (SSE connection state)
export {
  useStreamStore,
  type StreamState,
} from "./stream-store"
