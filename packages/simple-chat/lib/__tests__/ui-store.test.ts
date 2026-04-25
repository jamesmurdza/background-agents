/**
 * UI Store Tests
 *
 * Tests for the Zustand UI store, focusing on persistence and basic operations.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { useUIStore } from "@/lib/stores/ui-store"

describe("UI Store", () => {
  beforeEach(() => {
    // Reset store state
    useUIStore.setState({
      currentChatId: null,
      sidebarCollapsed: false,
      sidebarWidth: 260,
      mobileSidebarOpen: false,
      signInModalOpen: false,
      helpOpen: false,
      settingsOpen: false,
      settingsHighlightKey: null,
      repoFilter: "__all__",
      collapsedChatIds: new Set(),
      previewItems: {},
      queuedMessages: {},
      queuePaused: {},
      unseenChatIds: new Set(),
      deletingChatIds: new Set(),
      draftAgent: null,
      draftModel: null,
      pendingMessage: null,
      isHydrated: false,
    })
  })

  describe("currentChatId", () => {
    it("should set current chat ID", () => {
      const { setCurrentChatId } = useUIStore.getState()
      setCurrentChatId("chat-123")

      expect(useUIStore.getState().currentChatId).toBe("chat-123")
    })

    it("should mark chat as seen when selecting", () => {
      // Add chat to unseen first
      useUIStore.setState({
        unseenChatIds: new Set(["chat-123"]),
      })

      const { setCurrentChatId } = useUIStore.getState()
      setCurrentChatId("chat-123")

      expect(useUIStore.getState().unseenChatIds.has("chat-123")).toBe(false)
    })
  })

  describe("sidebar", () => {
    it("should toggle sidebar collapsed state", () => {
      const { toggleSidebar } = useUIStore.getState()

      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
      toggleSidebar()
      expect(useUIStore.getState().sidebarCollapsed).toBe(true)
      toggleSidebar()
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })

    it("should set sidebar width", () => {
      const { setSidebarWidth } = useUIStore.getState()
      setSidebarWidth(300)

      expect(useUIStore.getState().sidebarWidth).toBe(300)
    })
  })

  describe("unseenChatIds", () => {
    it("should mark chat as unseen", () => {
      const { markChatUnseen } = useUIStore.getState()
      markChatUnseen("chat-123")

      expect(useUIStore.getState().unseenChatIds.has("chat-123")).toBe(true)
    })

    it("should mark chat as seen", () => {
      useUIStore.setState({
        unseenChatIds: new Set(["chat-123"]),
      })

      const { markChatSeen } = useUIStore.getState()
      markChatSeen("chat-123")

      expect(useUIStore.getState().unseenChatIds.has("chat-123")).toBe(false)
    })

    it("should clear all unseen chats", () => {
      useUIStore.setState({
        unseenChatIds: new Set(["chat-1", "chat-2", "chat-3"]),
      })

      const { clearUnseenChats } = useUIStore.getState()
      clearUnseenChats()

      expect(useUIStore.getState().unseenChatIds.size).toBe(0)
    })
  })

  describe("queuedMessages", () => {
    it("should add queued message", () => {
      const { addQueuedMessage } = useUIStore.getState()
      addQueuedMessage("chat-123", { id: "q1", content: "Hello" })

      expect(useUIStore.getState().queuedMessages["chat-123"]).toEqual([
        { id: "q1", content: "Hello" },
      ])
    })

    it("should remove queued message", () => {
      useUIStore.setState({
        queuedMessages: {
          "chat-123": [
            { id: "q1", content: "Hello" },
            { id: "q2", content: "World" },
          ],
        },
      })

      const { removeQueuedMessage } = useUIStore.getState()
      removeQueuedMessage("chat-123", "q1")

      expect(useUIStore.getState().queuedMessages["chat-123"]).toEqual([
        { id: "q2", content: "World" },
      ])
    })
  })

  describe("cleanupDeletedChats", () => {
    it("should clean up all state for deleted chats", () => {
      useUIStore.setState({
        currentChatId: "chat-1",
        previewItems: {
          "chat-1": { type: "file", filePath: "/test", filename: "test" },
          "chat-2": { type: "terminal", id: "term-1" },
        },
        queuedMessages: {
          "chat-1": [{ id: "q1", content: "Test" }],
          "chat-2": [],
        },
        queuePaused: {
          "chat-1": true,
          "chat-2": false,
        },
        unseenChatIds: new Set(["chat-1"]),
        collapsedChatIds: new Set(["chat-1"]),
      })

      const { cleanupDeletedChats } = useUIStore.getState()
      cleanupDeletedChats(["chat-1"])

      const state = useUIStore.getState()
      expect(state.currentChatId).toBe(null)
      expect(state.previewItems["chat-1"]).toBeUndefined()
      expect(state.previewItems["chat-2"]).toBeDefined()
      expect(state.queuedMessages["chat-1"]).toBeUndefined()
      expect(state.queuePaused["chat-1"]).toBeUndefined()
      expect(state.unseenChatIds.has("chat-1")).toBe(false)
      expect(state.collapsedChatIds.has("chat-1")).toBe(false)
    })
  })

  describe("collapsedChatIds", () => {
    it("should toggle chat collapsed state", () => {
      const { toggleChatCollapsed } = useUIStore.getState()

      toggleChatCollapsed("chat-123")
      expect(useUIStore.getState().collapsedChatIds.has("chat-123")).toBe(true)

      toggleChatCollapsed("chat-123")
      expect(useUIStore.getState().collapsedChatIds.has("chat-123")).toBe(false)
    })

    it("should expand chat and ancestors", () => {
      useUIStore.setState({
        collapsedChatIds: new Set(["parent", "grandparent"]),
      })

      const parentMap = new Map<string, string | undefined>([
        ["child", "parent"],
        ["parent", "grandparent"],
        ["grandparent", undefined],
      ])

      const { expandChatAndAncestors } = useUIStore.getState()
      expandChatAndAncestors("child", parentMap)

      const collapsed = useUIStore.getState().collapsedChatIds
      expect(collapsed.has("parent")).toBe(false)
      expect(collapsed.has("grandparent")).toBe(false)
    })
  })
})
