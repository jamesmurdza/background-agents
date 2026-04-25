/**
 * UI State Store (Zustand)
 *
 * Holds all client-side UI state that doesn't belong in server state (TanStack Query)
 * or component-local state (useState). This includes:
 *
 * - Selection state (currentChatId)
 * - Sidebar state (collapsed, width, mobile open)
 * - Modal state (settings, sign-in, help, etc.)
 * - Filter state (repo filter, collapsed chat tree nodes)
 * - Local-only chat fields (preview items, queued messages)
 * - Tracking state (unseen chats, deleting chats)
 * - Draft state (for unauthenticated users)
 *
 * State is persisted to localStorage via Zustand persist middleware.
 */

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { Chat, QueuedMessage, Settings } from "@/lib/types"
import type { HighlightKey } from "@/components/modals/SettingsModal"

// =============================================================================
// Types
// =============================================================================

/** Preview item type - what's open in the preview pane */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }

/** Pending message for replay after OAuth redirect */
export interface PendingMessage {
  message: string
  agent: string
  model: string
}

// =============================================================================
// Store Interface
// =============================================================================

interface UIStore {
  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------
  currentChatId: string | null
  setCurrentChatId: (id: string | null) => void

  // -------------------------------------------------------------------------
  // Sidebar
  // -------------------------------------------------------------------------
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  sidebarWidth: number
  setSidebarWidth: (width: number) => void

  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void

  // -------------------------------------------------------------------------
  // Modals
  // -------------------------------------------------------------------------
  signInModalOpen: boolean
  setSignInModalOpen: (open: boolean) => void

  helpOpen: boolean
  setHelpOpen: (open: boolean) => void

  settingsOpen: boolean
  settingsHighlightKey: HighlightKey
  openSettings: (highlightKey?: HighlightKey) => void
  closeSettings: () => void

  // -------------------------------------------------------------------------
  // Filters & Navigation
  // -------------------------------------------------------------------------
  repoFilter: string
  setRepoFilter: (filter: string) => void

  collapsedChatIds: Set<string>
  toggleChatCollapsed: (id: string) => void
  expandChatAndAncestors: (targetId: string, parentMap: Map<string, string | undefined>) => void

  // -------------------------------------------------------------------------
  // Local-only Chat Fields (device-specific, not synced to server)
  // -------------------------------------------------------------------------
  previewItems: Record<string, PreviewItem | undefined>
  setPreviewItem: (chatId: string, item: PreviewItem | undefined) => void

  queuedMessages: Record<string, QueuedMessage[] | undefined>
  setQueuedMessages: (chatId: string, messages: QueuedMessage[] | undefined) => void
  addQueuedMessage: (chatId: string, message: QueuedMessage) => void
  removeQueuedMessage: (chatId: string, messageId: string) => void

  queuePaused: Record<string, boolean>
  setQueuePaused: (chatId: string, paused: boolean) => void

  // -------------------------------------------------------------------------
  // Tracking
  // -------------------------------------------------------------------------
  unseenChatIds: Set<string>
  markChatSeen: (chatId: string) => void
  markChatUnseen: (chatId: string) => void
  clearUnseenChats: () => void

  deletingChatIds: Set<string>
  setDeletingChatIds: (ids: Set<string>) => void
  addDeletingChatIds: (ids: string[]) => void
  removeDeletingChatIds: (ids: string[]) => void

  // -------------------------------------------------------------------------
  // Draft State (unauthenticated user composing before sign-in)
  // -------------------------------------------------------------------------
  draftAgent: string | null
  setDraftAgent: (agent: string | null) => void

  draftModel: string | null
  setDraftModel: (model: string | null) => void

  pendingMessage: PendingMessage | null
  setPendingMessage: (message: PendingMessage | null) => void

  // -------------------------------------------------------------------------
  // Hydration
  // -------------------------------------------------------------------------
  isHydrated: boolean
  setHydrated: (hydrated: boolean) => void

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  cleanupDeletedChats: (deletedIds: string[]) => void
}

// =============================================================================
// Constants
// =============================================================================

export const ALL_REPOSITORIES = "__all__"
export const NO_REPOSITORY = "__none__"

const DEFAULT_SIDEBAR_WIDTH = 260

// =============================================================================
// Store Implementation
// =============================================================================

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      // -----------------------------------------------------------------------
      // Selection
      // -----------------------------------------------------------------------
      currentChatId: null,
      setCurrentChatId: (id) => {
        set({ currentChatId: id })
        // Mark as seen when selecting
        if (id) {
          get().markChatSeen(id)
        }
      },

      // -----------------------------------------------------------------------
      // Sidebar
      // -----------------------------------------------------------------------
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      mobileSidebarOpen: false,
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),

      // -----------------------------------------------------------------------
      // Modals
      // -----------------------------------------------------------------------
      signInModalOpen: false,
      setSignInModalOpen: (open) => set({ signInModalOpen: open }),

      helpOpen: false,
      setHelpOpen: (open) => set({ helpOpen: open }),

      settingsOpen: false,
      settingsHighlightKey: null,
      openSettings: (highlightKey = null) =>
        set({ settingsOpen: true, settingsHighlightKey: highlightKey }),
      closeSettings: () =>
        set({ settingsOpen: false, settingsHighlightKey: null }),

      // -----------------------------------------------------------------------
      // Filters & Navigation
      // -----------------------------------------------------------------------
      repoFilter: ALL_REPOSITORIES,
      setRepoFilter: (filter) => set({ repoFilter: filter }),

      collapsedChatIds: new Set(),
      toggleChatCollapsed: (id) =>
        set((state) => {
          const next = new Set(state.collapsedChatIds)
          if (next.has(id)) {
            next.delete(id)
          } else {
            next.add(id)
          }
          return { collapsedChatIds: next }
        }),
      expandChatAndAncestors: (targetId, parentMap) =>
        set((state) => {
          const next = new Set(state.collapsedChatIds)
          let cur = parentMap.get(targetId)
          while (cur) {
            next.delete(cur)
            cur = parentMap.get(cur)
          }
          return { collapsedChatIds: next }
        }),

      // -----------------------------------------------------------------------
      // Local-only Chat Fields
      // -----------------------------------------------------------------------
      previewItems: {},
      setPreviewItem: (chatId, item) =>
        set((state) => ({
          previewItems: { ...state.previewItems, [chatId]: item },
        })),

      queuedMessages: {},
      setQueuedMessages: (chatId, messages) =>
        set((state) => ({
          queuedMessages: { ...state.queuedMessages, [chatId]: messages },
        })),
      addQueuedMessage: (chatId, message) =>
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [chatId]: [...(state.queuedMessages[chatId] ?? []), message],
          },
        })),
      removeQueuedMessage: (chatId, messageId) =>
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [chatId]: (state.queuedMessages[chatId] ?? []).filter(
              (m) => m.id !== messageId
            ),
          },
        })),

      queuePaused: {},
      setQueuePaused: (chatId, paused) =>
        set((state) => ({
          queuePaused: { ...state.queuePaused, [chatId]: paused },
        })),

      // -----------------------------------------------------------------------
      // Tracking
      // -----------------------------------------------------------------------
      unseenChatIds: new Set(),
      markChatSeen: (chatId) =>
        set((state) => {
          if (!state.unseenChatIds.has(chatId)) return state
          const next = new Set(state.unseenChatIds)
          next.delete(chatId)
          return { unseenChatIds: next }
        }),
      markChatUnseen: (chatId) =>
        set((state) => {
          if (state.unseenChatIds.has(chatId)) return state
          const next = new Set(state.unseenChatIds)
          next.add(chatId)
          return { unseenChatIds: next }
        }),
      clearUnseenChats: () => set({ unseenChatIds: new Set() }),

      deletingChatIds: new Set(),
      setDeletingChatIds: (ids) => set({ deletingChatIds: ids }),
      addDeletingChatIds: (ids) =>
        set((state) => ({
          deletingChatIds: new Set([...state.deletingChatIds, ...ids]),
        })),
      removeDeletingChatIds: (ids) =>
        set((state) => {
          const next = new Set(state.deletingChatIds)
          for (const id of ids) next.delete(id)
          return { deletingChatIds: next }
        }),

      // -----------------------------------------------------------------------
      // Draft State
      // -----------------------------------------------------------------------
      draftAgent: null,
      setDraftAgent: (agent) => set({ draftAgent: agent }),

      draftModel: null,
      setDraftModel: (model) => set({ draftModel: model }),

      pendingMessage: null,
      setPendingMessage: (message) => set({ pendingMessage: message }),

      // -----------------------------------------------------------------------
      // Hydration
      // -----------------------------------------------------------------------
      isHydrated: false,
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),

      // -----------------------------------------------------------------------
      // Cleanup
      // -----------------------------------------------------------------------
      cleanupDeletedChats: (deletedIds) =>
        set((state) => {
          const deletedSet = new Set(deletedIds)

          // Clean preview items
          const newPreviewItems = { ...state.previewItems }
          for (const id of deletedIds) delete newPreviewItems[id]

          // Clean queued messages
          const newQueuedMessages = { ...state.queuedMessages }
          for (const id of deletedIds) delete newQueuedMessages[id]

          // Clean queue paused
          const newQueuePaused = { ...state.queuePaused }
          for (const id of deletedIds) delete newQueuePaused[id]

          // Clean unseen
          const newUnseen = new Set(state.unseenChatIds)
          for (const id of deletedIds) newUnseen.delete(id)

          // Clean collapsed
          const newCollapsed = new Set(state.collapsedChatIds)
          for (const id of deletedIds) newCollapsed.delete(id)

          // Reset currentChatId if deleted
          const newCurrentChatId = deletedSet.has(state.currentChatId ?? "")
            ? null
            : state.currentChatId

          return {
            previewItems: newPreviewItems,
            queuedMessages: newQueuedMessages,
            queuePaused: newQueuePaused,
            unseenChatIds: newUnseen,
            collapsedChatIds: newCollapsed,
            currentChatId: newCurrentChatId,
          }
        }),
    }),
    {
      name: "simple-chat-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist specific fields
      partialize: (state) => ({
        currentChatId: state.currentChatId,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        repoFilter: state.repoFilter,
        previewItems: state.previewItems,
        queuedMessages: state.queuedMessages,
        queuePaused: state.queuePaused,
        // Convert Sets to arrays for serialization
        unseenChatIds: Array.from(state.unseenChatIds),
        collapsedChatIds: Array.from(state.collapsedChatIds),
      }),
      // Custom merge to handle Set reconstruction
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UIStore> & {
          unseenChatIds?: string[]
          collapsedChatIds?: string[]
        }
        return {
          ...currentState,
          ...persisted,
          // Reconstruct Sets from arrays
          unseenChatIds: new Set(persisted.unseenChatIds ?? []),
          collapsedChatIds: new Set(persisted.collapsedChatIds ?? []),
          // Mark as hydrated after merge
          isHydrated: true,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true)
        }
      },
    }
  )
)

// =============================================================================
// Selector Hooks (for optimized re-renders)
// =============================================================================

/** Get current chat ID */
export const useCurrentChatId = () => useUIStore((s) => s.currentChatId)

/** Get sidebar collapsed state */
export const useSidebarCollapsed = () => useUIStore((s) => s.sidebarCollapsed)

/** Get sidebar width */
export const useSidebarWidth = () => useUIStore((s) => s.sidebarWidth)

/** Get mobile sidebar open state */
export const useMobileSidebarOpen = () => useUIStore((s) => s.mobileSidebarOpen)

/** Get repo filter */
export const useRepoFilter = () => useUIStore((s) => s.repoFilter)

/** Get preview item for current chat */
export const useCurrentPreviewItem = () =>
  useUIStore((s) => {
    const chatId = s.currentChatId
    return chatId ? s.previewItems[chatId] : undefined
  })

/** Get queued messages for current chat */
export const useCurrentQueuedMessages = () =>
  useUIStore((s) => {
    const chatId = s.currentChatId
    return chatId ? s.queuedMessages[chatId] : undefined
  })

/** Get queue paused state for current chat */
export const useCurrentQueuePaused = () =>
  useUIStore((s) => {
    const chatId = s.currentChatId
    return chatId ? s.queuePaused[chatId] ?? false : false
  })

/** Check if a chat has unseen completion */
export const useChatUnseen = (chatId: string) =>
  useUIStore((s) => s.unseenChatIds.has(chatId))

/** Get unseen chat IDs set */
export const useUnseenChatIds = () => useUIStore((s) => s.unseenChatIds)

/** Get deleting chat IDs set */
export const useDeletingChatIds = () => useUIStore((s) => s.deletingChatIds)

/** Get hydration state */
export const useIsHydrated = () => useUIStore((s) => s.isHydrated)
