/**
 * Custom Hooks
 *
 * Export all custom hooks from a single entry point.
 */

// New unified chat hook (replaces useChatWithSync)
export { useChat } from "./useChat"

// Legacy hook (deprecated, kept for migration)
export { useChatWithSync } from "./useChatWithSync"

// Utility hooks
export { useMobile } from "./useMobile"
export { usePullToRefresh } from "./usePullToRefresh"
