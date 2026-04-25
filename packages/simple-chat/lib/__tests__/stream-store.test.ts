/**
 * Stream Store Tests
 *
 * Tests for the SSE stream store, focusing on connection management.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { useStreamStore } from "@/lib/stores/stream-store"

// Mock the cache update helpers to avoid query client dependency
vi.mock("@/lib/queries/cache-updates", () => ({
  updateMessageInCache: vi.fn(),
  markStreamComplete: vi.fn(),
  markStreamError: vi.fn(),
}))

describe("Stream Store", () => {
  beforeEach(() => {
    // Reset store state
    const store = useStreamStore.getState()
    for (const chatId of store.streams.keys()) {
      store.disconnect(chatId)
    }
  })

  describe("isStreaming", () => {
    it("should return false for non-streaming chat", () => {
      const { isStreaming } = useStreamStore.getState()
      expect(isStreaming("chat-123")).toBe(false)
    })

    it("should return true after connect", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })

      expect(store.isStreaming("chat-123")).toBe(true)
    })

    it("should return false after disconnect", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })
      store.disconnect("chat-123")

      expect(store.isStreaming("chat-123")).toBe(false)
    })
  })

  describe("connect/disconnect", () => {
    it("should store connection params", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
        previewUrlPattern: "http://localhost:{port}",
      })

      const stream = store.getStream("chat-123")
      expect(stream?.connectionParams).toEqual({
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
        previewUrlPattern: "http://localhost:{port}",
      })
    })

    it("should close existing connection when reconnecting", () => {
      const store = useStreamStore.getState()

      // First connection
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })

      const firstStream = store.getStream("chat-123")
      const firstEventSource = firstStream?.eventSource

      // Second connection
      store.connect("chat-123", {
        sandboxId: "sandbox-2",
        repoName: "project",
        backgroundSessionId: "session-2",
        assistantMessageId: "msg-2",
      })

      // First should be closed
      expect(firstEventSource?.readyState).toBe(2) // CLOSED

      // New connection should exist
      const newStream = store.getStream("chat-123")
      expect(newStream?.connectionParams?.sandboxId).toBe("sandbox-2")
    })

    it("should remove stream on disconnect", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })
      store.disconnect("chat-123")

      expect(store.getStream("chat-123")).toBeUndefined()
    })
  })

  describe("ensureStreamsFor", () => {
    it("should only connect chats that need streaming", () => {
      const store = useStreamStore.getState()

      const chats = [
        // Should connect - has backgroundSessionId and sandboxId
        {
          id: "chat-1",
          sandboxId: "sandbox-1",
          backgroundSessionId: "session-1",
          messages: [{ id: "msg-1", role: "assistant" as const, content: "", timestamp: 0 }],
        },
        // Should NOT connect - no backgroundSessionId
        {
          id: "chat-2",
          sandboxId: "sandbox-2",
          backgroundSessionId: null,
          messages: [{ id: "msg-2", role: "assistant" as const, content: "", timestamp: 0 }],
        },
        // Should NOT connect - no sandboxId
        {
          id: "chat-3",
          sandboxId: null,
          backgroundSessionId: "session-3",
          messages: [{ id: "msg-3", role: "assistant" as const, content: "", timestamp: 0 }],
        },
        // Should NOT connect - no assistant message
        {
          id: "chat-4",
          sandboxId: "sandbox-4",
          backgroundSessionId: "session-4",
          messages: [{ id: "msg-4", role: "user" as const, content: "Hello", timestamp: 0 }],
        },
      ]

      store.ensureStreamsFor(chats)

      expect(store.isStreaming("chat-1")).toBe(true)
      expect(store.isStreaming("chat-2")).toBe(false)
      expect(store.isStreaming("chat-3")).toBe(false)
      expect(store.isStreaming("chat-4")).toBe(false)
    })

    it("should not reconnect already-streaming chats", () => {
      const store = useStreamStore.getState()

      // Connect first time
      store.connect("chat-1", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })

      const firstStream = store.getStream("chat-1")
      const firstEventSource = firstStream?.eventSource

      // Call ensureStreamsFor with the same chat
      store.ensureStreamsFor([
        {
          id: "chat-1",
          sandboxId: "sandbox-1",
          backgroundSessionId: "session-1",
          messages: [{ id: "msg-1", role: "assistant" as const, content: "", timestamp: 0 }],
        },
      ])

      // Should be the same connection (not reconnected)
      const currentStream = store.getStream("chat-1")
      expect(currentStream?.eventSource).toBe(firstEventSource)
    })
  })

  describe("updateStream", () => {
    it("should update cursor position", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })

      store.updateStream("chat-123", { cursor: 42 })

      expect(store.getStream("chat-123")?.cursor).toBe(42)
    })

    it("should update reconnect attempts", () => {
      const store = useStreamStore.getState()
      store.connect("chat-123", {
        sandboxId: "sandbox-1",
        repoName: "project",
        backgroundSessionId: "session-1",
        assistantMessageId: "msg-1",
      })

      store.updateStream("chat-123", { reconnectAttempts: 3 })

      expect(store.getStream("chat-123")?.reconnectAttempts).toBe(3)
    })

    it("should not update non-existent stream", () => {
      const store = useStreamStore.getState()
      const before = store.streams.size

      store.updateStream("nonexistent", { cursor: 100 })

      expect(store.streams.size).toBe(before)
    })
  })
})
