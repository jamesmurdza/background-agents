/**
 * Cache Updates Tests
 *
 * Tests for the TanStack Query cache update helpers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { QueryClient } from "@tanstack/react-query"

// Create a mock query client
let queryClient: QueryClient

// Mock the provider to return our test client
vi.mock("@/lib/queries/provider", () => ({
  getQueryClient: () => queryClient,
}))

// Now import the functions under test (after mocking)
import {
  updateMessageInCache,
  markStreamComplete,
  markStreamError,
  updateChatInCache,
  addOptimisticMessages,
} from "@/lib/queries/cache-updates"
import { chatKeys } from "@/lib/queries/keys"
import type { ChatDetail, ChatListItem } from "@/lib/queries/chats"

describe("Cache Updates", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  describe("updateMessageInCache", () => {
    it("should update message content in detail cache", () => {
      // Set up initial cache state
      const initialDetail: ChatDetail = {
        id: "chat-1",
        repo: "owner/repo",
        baseBranch: "main",
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: "opencode",
        displayName: null,
        status: "running",
        createdAt: 0,
        updatedAt: 0,
        messages: [
          { id: "msg-1", role: "user", content: "Hello", timestamp: 0 },
          { id: "msg-2", role: "assistant", content: "", timestamp: 1, toolCalls: [], contentBlocks: [] },
        ],
      }
      queryClient.setQueryData(chatKeys.detail("chat-1"), initialDetail)

      // Update the message
      updateMessageInCache("chat-1", "msg-2", {
        content: "Hello! How can I help?",
        toolCalls: [],
        contentBlocks: [{ type: "text", text: "Hello! How can I help?" }],
      })

      // Verify the update
      const updated = queryClient.getQueryData<ChatDetail>(chatKeys.detail("chat-1"))
      const assistantMsg = updated?.messages.find((m) => m.id === "msg-2")
      expect(assistantMsg?.content).toBe("Hello! How can I help?")
      expect(assistantMsg?.contentBlocks).toEqual([{ type: "text", text: "Hello! How can I help?" }])
    })

    it("should update lastActiveAt in list cache", () => {
      const initialList: ChatListItem[] = [
        {
          id: "chat-1",
          repo: "owner/repo",
          baseBranch: "main",
          branch: null,
          sandboxId: null,
          sessionId: null,
          agent: "opencode",
          displayName: null,
          status: "running",
          createdAt: 0,
          updatedAt: 0,
          lastActiveAt: 0,
          messageCount: 2,
        },
      ]
      queryClient.setQueryData(chatKeys.all, initialList)

      const before = Date.now()
      updateMessageInCache("chat-1", "msg-2", {
        content: "Updated",
        toolCalls: [],
        contentBlocks: [],
      })
      const after = Date.now()

      const updated = queryClient.getQueryData<ChatListItem[]>(chatKeys.all)
      const chat = updated?.find((c) => c.id === "chat-1")
      expect(chat?.lastActiveAt).toBeGreaterThanOrEqual(before)
      expect(chat?.lastActiveAt).toBeLessThanOrEqual(after)
    })
  })

  describe("markStreamComplete", () => {
    it("should update status to ready on completion", () => {
      const initialDetail: ChatDetail = {
        id: "chat-1",
        repo: "owner/repo",
        baseBranch: "main",
        branch: "feature",
        sandboxId: "sandbox-1",
        sessionId: null,
        agent: "opencode",
        displayName: null,
        status: "running",
        backgroundSessionId: "session-1",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      }
      queryClient.setQueryData(chatKeys.detail("chat-1"), initialDetail)

      markStreamComplete("chat-1", {
        status: "completed",
        sessionId: "new-session",
        cursor: 100,
      })

      const updated = queryClient.getQueryData<ChatDetail>(chatKeys.detail("chat-1"))
      expect(updated?.status).toBe("ready")
      expect(updated?.sessionId).toBe("new-session")
      expect(updated?.backgroundSessionId).toBeUndefined()
    })

    it("should update status to error on failure", () => {
      const initialDetail: ChatDetail = {
        id: "chat-1",
        repo: "owner/repo",
        baseBranch: "main",
        branch: null,
        sandboxId: "sandbox-1",
        sessionId: null,
        agent: "opencode",
        displayName: null,
        status: "running",
        backgroundSessionId: "session-1",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      }
      queryClient.setQueryData(chatKeys.detail("chat-1"), initialDetail)

      markStreamComplete("chat-1", {
        status: "error",
        error: "Something went wrong",
        cursor: 50,
      })

      const updated = queryClient.getQueryData<ChatDetail>(chatKeys.detail("chat-1"))
      expect(updated?.status).toBe("error")
      expect(updated?.errorMessage).toBe("Something went wrong")
    })
  })

  describe("markStreamError", () => {
    it("should set error status and message", () => {
      const initialList: ChatListItem[] = [
        {
          id: "chat-1",
          repo: "owner/repo",
          baseBranch: "main",
          branch: null,
          sandboxId: "sandbox-1",
          sessionId: null,
          agent: "opencode",
          displayName: null,
          status: "running",
          createdAt: 0,
          updatedAt: 0,
          messageCount: 0,
        },
      ]
      queryClient.setQueryData(chatKeys.all, initialList)

      markStreamError("chat-1", "Connection lost")

      const updated = queryClient.getQueryData<ChatListItem[]>(chatKeys.all)
      const chat = updated?.find((c) => c.id === "chat-1")
      expect(chat?.status).toBe("error")
      expect(chat?.errorMessage).toBe("Connection lost")
    })
  })

  describe("updateChatInCache", () => {
    it("should update chat fields in both caches", () => {
      const initialDetail: ChatDetail = {
        id: "chat-1",
        repo: "owner/repo",
        baseBranch: "main",
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: "opencode",
        displayName: null,
        status: "pending",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      }
      queryClient.setQueryData(chatKeys.detail("chat-1"), initialDetail)

      const initialList: ChatListItem[] = [
        { ...initialDetail, messageCount: 0 },
      ]
      queryClient.setQueryData(chatKeys.all, initialList)

      updateChatInCache("chat-1", {
        displayName: "New Name",
        agent: "claude-code",
      })

      const updatedDetail = queryClient.getQueryData<ChatDetail>(chatKeys.detail("chat-1"))
      expect(updatedDetail?.displayName).toBe("New Name")
      expect(updatedDetail?.agent).toBe("claude-code")

      const updatedList = queryClient.getQueryData<ChatListItem[]>(chatKeys.all)
      const listChat = updatedList?.find((c) => c.id === "chat-1")
      expect(listChat?.displayName).toBe("New Name")
      expect(listChat?.agent).toBe("claude-code")
    })
  })

  describe("addOptimisticMessages", () => {
    it("should add messages to detail cache", () => {
      const initialDetail: ChatDetail = {
        id: "chat-1",
        repo: "owner/repo",
        baseBranch: "main",
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: "opencode",
        displayName: null,
        status: "pending",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      }
      queryClient.setQueryData(chatKeys.detail("chat-1"), initialDetail)

      const userMsg = { id: "user-1", role: "user" as const, content: "Hello", timestamp: 0 }
      const assistantMsg = { id: "asst-1", role: "assistant" as const, content: "", timestamp: 1 }

      addOptimisticMessages("chat-1", userMsg, assistantMsg)

      const updated = queryClient.getQueryData<ChatDetail>(chatKeys.detail("chat-1"))
      expect(updated?.messages).toHaveLength(2)
      expect(updated?.messages[0].id).toBe("user-1")
      expect(updated?.messages[1].id).toBe("asst-1")
    })

    it("should increment message count in list cache", () => {
      const initialList: ChatListItem[] = [
        {
          id: "chat-1",
          repo: "owner/repo",
          baseBranch: "main",
          branch: null,
          sandboxId: null,
          sessionId: null,
          agent: "opencode",
          displayName: null,
          status: "pending",
          createdAt: 0,
          updatedAt: 0,
          messageCount: 5,
        },
      ]
      queryClient.setQueryData(chatKeys.all, initialList)

      const userMsg = { id: "user-1", role: "user" as const, content: "Hello", timestamp: 0 }
      const assistantMsg = { id: "asst-1", role: "assistant" as const, content: "", timestamp: 1 }

      addOptimisticMessages("chat-1", userMsg, assistantMsg)

      const updated = queryClient.getQueryData<ChatListItem[]>(chatKeys.all)
      const chat = updated?.find((c) => c.id === "chat-1")
      expect(chat?.messageCount).toBe(7) // 5 + 2
    })
  })
})
