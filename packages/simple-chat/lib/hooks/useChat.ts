"use client"

/**
 * useChat - New unified hook replacing useChatWithSync
 *
 * This hook composes:
 * - TanStack Query (server reads)
 * - TanStack Mutations (server writes)
 * - UI Zustand store (client UI state)
 * - Stream store (SSE connections)
 *
 * It provides the same interface as useChatWithSync for easy migration,
 * but with proper separation of concerns.
 */

import { useEffect, useCallback, useRef, useMemo } from "react"
import { useSession } from "next-auth/react"
import { useQueryClient } from "@tanstack/react-query"
import { nanoid } from "nanoid"

// Queries
import {
  useChatsQuery,
  useChatQuery,
  useSettingsQuery,
  chatKeys,
  type ChatDetail,
  type ChatListItem,
} from "@/lib/queries"

// Mutations
import {
  useCreateChat,
  useUpdateChat,
  useDeleteChat,
  useSendMessage,
  useUpdateSettings,
  generateChatName,
} from "@/lib/mutations"

// Stores
import {
  useUIStore,
  useStreamStore,
} from "@/lib/stores"

// Types
import type { Chat, Message, Settings, QueuedMessage, ChatStatus } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import { generateBranchName } from "@/lib/utils"
import { DEFAULT_SETTINGS } from "@/lib/storage"

// =============================================================================
// Hook
// =============================================================================

export function useChat() {
  const { data: session, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  // -------------------------------------------------------------------------
  // UI Store
  // -------------------------------------------------------------------------
  const uiStore = useUIStore()
  const {
    currentChatId,
    setCurrentChatId,
    previewItems,
    setPreviewItem,
    queuedMessages,
    setQueuedMessages,
    addQueuedMessage,
    removeQueuedMessage: removeQueuedMessageFromStore,
    queuePaused,
    setQueuePaused,
    unseenChatIds,
    markChatSeen,
    markChatUnseen,
    deletingChatIds,
    addDeletingChatIds,
    removeDeletingChatIds,
    cleanupDeletedChats,
    isHydrated,
  } = uiStore

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  const {
    data: chatsData,
    isLoading: isChatsLoading,
  } = useChatsQuery()

  const {
    data: currentChatData,
  } = useChatQuery(currentChatId)

  const {
    data: settingsData,
    isLoading: isSettingsLoading,
  } = useSettingsQuery()

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const createChatMutation = useCreateChat()
  const updateChatMutation = useUpdateChat()
  const deleteChatMutation = useDeleteChat()
  const sendMessageMutation = useSendMessage()
  const updateSettingsMutation = useUpdateSettings()

  // -------------------------------------------------------------------------
  // Stream Store
  // -------------------------------------------------------------------------
  const streamStore = useStreamStore()

  // -------------------------------------------------------------------------
  // Derived State
  // -------------------------------------------------------------------------

  // Combine chat list with local fields
  const chats: Chat[] = useMemo(() => {
    if (!chatsData) return []

    return chatsData.map((chat) => ({
      ...chat,
      messages: [], // Messages only loaded on detail view
      previewItem: previewItems[chat.id],
      queuedMessages: queuedMessages[chat.id],
      queuePaused: queuePaused[chat.id] ?? false,
    }))
  }, [chatsData, previewItems, queuedMessages, queuePaused])

  // Current chat with full messages
  const currentChat: Chat | null = useMemo(() => {
    if (!currentChatId) return null

    // If we have detail data, use it
    if (currentChatData) {
      return {
        ...currentChatData,
        previewItem: previewItems[currentChatId],
        queuedMessages: queuedMessages[currentChatId],
        queuePaused: queuePaused[currentChatId] ?? false,
      }
    }

    // Fall back to list item (without messages)
    const listItem = chatsData?.find((c) => c.id === currentChatId)
    if (listItem) {
      return {
        ...listItem,
        messages: [],
        previewItem: previewItems[currentChatId],
        queuedMessages: queuedMessages[currentChatId],
        queuePaused: queuePaused[currentChatId] ?? false,
      }
    }

    return null
  }, [currentChatId, currentChatData, chatsData, previewItems, queuedMessages, queuePaused])

  const settings = settingsData?.settings ?? DEFAULT_SETTINGS
  const credentialFlags = settingsData?.credentialFlags ?? {}
  const isLoading = isChatsLoading || isSettingsLoading

  // -------------------------------------------------------------------------
  // Track status changes for unseen detection
  // -------------------------------------------------------------------------
  const prevStatuses = useRef<Map<string, ChatStatus>>(new Map())

  useEffect(() => {
    if (!isHydrated || !chatsData) return

    const currentIds = new Set<string>()
    for (const chat of chatsData) {
      currentIds.add(chat.id)
      const prevStatus = prevStatuses.current.get(chat.id)
      if (
        prevStatus === "running" &&
        chat.status !== "running" &&
        chat.id !== currentChatId
      ) {
        markChatUnseen(chat.id)
      }
      prevStatuses.current.set(chat.id, chat.status)
    }

    // Clean up old entries
    for (const id of Array.from(prevStatuses.current.keys())) {
      if (!currentIds.has(id)) prevStatuses.current.delete(id)
    }
  }, [chatsData, currentChatId, isHydrated, markChatUnseen])

  // -------------------------------------------------------------------------
  // Stream Recovery
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isHydrated || !chatsData) return

    // Get chats with full message data for recovery
    const runningChats = chatsData.filter(
      (c) => c.backgroundSessionId && c.sandboxId
    )

    if (runningChats.length === 0) return

    // For each running chat, we need its messages to find the assistant message ID
    // The streamStore.ensureStreamsFor will handle this
    const chatsWithMessages = runningChats.map((chat) => {
      // Try to get from detail cache first
      const detail = queryClient.getQueryData<ChatDetail>(chatKeys.detail(chat.id))
      return {
        ...chat,
        messages: detail?.messages ?? [],
      }
    })

    streamStore.ensureStreamsFor(chatsWithMessages)
  }, [isHydrated, chatsData, queryClient, streamStore])

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      // Disconnect all streams on unmount
      for (const chatId of streamStore.streams.keys()) {
        streamStore.disconnect(chatId)
      }
    }
  }, [streamStore])

  // -------------------------------------------------------------------------
  // In-flight guard for sendMessage
  // -------------------------------------------------------------------------
  const sendInFlight = useRef<Set<string>>(new Set())

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const startNewChat = useCallback(async (
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
  ): Promise<string | null> => {
    try {
      const result = await createChatMutation.mutateAsync({
        repo,
        baseBranch,
        parentChatId,
        status: initialStatus,
      })

      if (switchTo) {
        setCurrentChatId(result.id)
      }

      return result.id
    } catch (error) {
      console.error("Failed to create chat:", error)
      return null
    }
  }, [createChatMutation, setCurrentChatId])

  const selectChat = useCallback(async (chatId: string) => {
    markChatSeen(chatId)
    setCurrentChatId(chatId)
    // Messages will be loaded by useChatQuery when currentChatId changes
  }, [markChatSeen, setCurrentChatId])

  const removeChat = useCallback(async (chatId: string) => {
    // Collect descendant IDs
    const allChats = chatsData ?? []
    const allIds = collectDescendantIds(allChats, chatId)

    addDeletingChatIds(allIds)

    try {
      const result = await deleteChatMutation.mutateAsync({
        chatId,
        chats: allChats.map((c) => ({ id: c.id, parentChatId: c.parentChatId })),
      })

      cleanupDeletedChats(result.deletedChatIds)

      // Select next chat if current was deleted
      if (currentChatId && result.deletedChatIds.includes(currentChatId)) {
        const remaining = (chatsData ?? []).filter(
          (c) => !result.deletedChatIds.includes(c.id)
        )
        setCurrentChatId(remaining[0]?.id ?? null)
      }
    } catch (error) {
      console.error("Failed to delete chat:", error)
    } finally {
      removeDeletingChatIds(allIds)
    }
  }, [
    chatsData,
    currentChatId,
    addDeletingChatIds,
    removeDeletingChatIds,
    cleanupDeletedChats,
    deleteChatMutation,
    setCurrentChatId,
  ])

  const renameChat = useCallback(async (chatId: string, newName: string) => {
    try {
      await updateChatMutation.mutateAsync({
        chatId,
        data: { displayName: newName },
      })
    } catch (error) {
      console.error("Failed to rename chat:", error)
    }
  }, [updateChatMutation])

  const updateChatRepo = useCallback(async (chatId: string, repo: string, baseBranch: string) => {
    const chat = chatsData?.find((c) => c.id === chatId)
    if (!chat) return

    const detail = queryClient.getQueryData<ChatDetail>(chatKeys.detail(chatId))
    const hasMessages = (detail?.messages.length ?? 0) > 0

    const canSelectRepo = !hasMessages && !chat.sandboxId
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY

    if (!canSelectRepo && !canAssignNewRepo) return

    try {
      await updateChatMutation.mutateAsync({
        chatId,
        data: { repo, baseBranch },
      })
    } catch (error) {
      console.error("Failed to update chat repo:", error)
    }
  }, [chatsData, queryClient, updateChatMutation])

  const updateCurrentChat = useCallback(async (updates: Partial<Chat>) => {
    if (!currentChatId) return

    // Handle preview item locally
    if ("previewItem" in updates) {
      setPreviewItem(currentChatId, updates.previewItem)
    }

    // Send other updates to server
    const serverUpdates = { ...updates }
    delete serverUpdates.previewItem
    delete serverUpdates.queuedMessages
    delete serverUpdates.queuePaused

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({
          chatId: currentChatId,
          data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"],
        })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [currentChatId, updateChatMutation, setPreviewItem])

  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    // Handle preview item locally
    if ("previewItem" in updates) {
      setPreviewItem(chatId, updates.previewItem)
    }

    // Send other updates to server
    const serverUpdates = { ...updates }
    delete serverUpdates.previewItem
    delete serverUpdates.queuedMessages
    delete serverUpdates.queuePaused

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({
          chatId,
          data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"],
        })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [updateChatMutation, setPreviewItem])

  const updateSettings = useCallback(async (data: {
    settings?: Partial<Settings>
    credentials?: Credentials
  }): Promise<{ ok: boolean; error?: string }> => {
    const result = await updateSettingsMutation.mutateAsync(data)
    return result
  }, [updateSettingsMutation])

  const sendMessage = useCallback(async (
    content: string,
    agent?: string,
    model?: string,
    files?: File[],
    targetChatId?: string
  ) => {
    const chatId = targetChatId || currentChatId
    if (!chatId) return

    // Get chat data
    const chatListItem = chatsData?.find((c) => c.id === chatId)
    const chatDetail = queryClient.getQueryData<ChatDetail>(chatKeys.detail(chatId))

    if (!chatListItem) return

    // Concurrency guards
    if (sendInFlight.current.has(chatId)) {
      console.warn("Send already in flight for this chat")
      return
    }
    if (streamStore.isStreaming(chatId)) {
      console.warn("Already streaming for this chat")
      return
    }
    if (chatListItem.status === "creating" || chatListItem.status === "running") {
      console.warn(`Chat is ${chatListItem.status}; can't send`)
      return
    }

    // Require session
    if (!session?.accessToken) return

    sendInFlight.current.add(chatId)

    try {
      const isFirstMessage = (chatDetail?.messages.length ?? 0) === 0
      const selectedAgent = agent || chatListItem.agent || settings.defaultAgent
      const selectedModel = model || chatListItem.model || settings.defaultModel

      // Create optimistic messages
      const userMessage: Message = {
        id: nanoid(),
        role: "user",
        content,
        timestamp: Date.now(),
      }
      const assistantMessage: Message = {
        id: nanoid(),
        role: "assistant",
        content: "",
        timestamp: Date.now() + 1,
        toolCalls: [],
        contentBlocks: [],
      }

      // Clear queue paused
      setQueuePaused(chatId, false)

      // Send message
      const result = await sendMessageMutation.mutateAsync({
        chatId,
        content,
        agent: selectedAgent,
        model: selectedModel,
        files,
        chat: {
          messages: chatDetail?.messages ?? [],
          sandboxId: chatListItem.sandboxId,
          status: chatListItem.status,
        },
      })

      // Start SSE stream
      streamStore.connect(chatId, {
        sandboxId: result.sandboxId,
        repoName: "project",
        backgroundSessionId: result.backgroundSessionId,
        assistantMessageId: result.assistantMessageId,
        previewUrlPattern: result.previewUrlPattern ?? undefined,
      }, {
        onComplete: async (data) => {
          // Auto-push for GitHub repos
          if (data.status === "completed") {
            const chat = queryClient.getQueryData<ChatDetail>(chatKeys.detail(chatId))
            if (chat?.branch && chat.repo !== NEW_REPOSITORY) {
              fetch("/api/git/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: result.sandboxId,
                  repoName: "project",
                  branch: chat.branch,
                }),
              }).catch((err) => console.error("Auto-push failed:", err))
            }
          }
        },
      })

      // Generate chat name for first message (fire-and-forget)
      if (isFirstMessage) {
        generateChatName(chatId, content)
      }
    } catch (error) {
      console.error("Failed to send message:", error)
    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [
    currentChatId,
    chatsData,
    queryClient,
    streamStore,
    session?.accessToken,
    settings,
    sendMessageMutation,
    setQueuePaused,
  ])

  const stopAgent = useCallback(() => {
    if (!currentChat) return

    streamStore.disconnect(currentChat.id)

    const hasQueue = (queuedMessages[currentChat.id]?.length ?? 0) > 0
    if (hasQueue) {
      setQueuePaused(currentChat.id, true)
    }

    // Update status to ready
    updateChatMutation.mutate({
      chatId: currentChat.id,
      data: { status: "ready", backgroundSessionId: null },
    })
  }, [currentChat, streamStore, queuedMessages, setQueuePaused, updateChatMutation])

  const addMessage = useCallback((chatId: string, message: Message) => {
    // Add message to cache
    queryClient.setQueryData<ChatDetail>(chatKeys.detail(chatId), (cur) => {
      if (!cur) return cur
      return {
        ...cur,
        messages: [...cur.messages, message],
      }
    })
  }, [queryClient])

  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChatId) return

    const queued: QueuedMessage = {
      id: `q-${Date.now()}`,
      content,
      agent,
      model,
    }

    addQueuedMessage(currentChatId, queued)
    setQueuePaused(currentChatId, false)
  }, [currentChatId, addQueuedMessage, setQueuePaused])

  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChatId) return
    removeQueuedMessageFromStore(currentChatId, id)
  }, [currentChatId, removeQueuedMessageFromStore])

  const resumeQueue = useCallback(() => {
    if (!currentChatId) return
    setQueuePaused(currentChatId, false)
  }, [currentChatId, setQueuePaused])

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // State
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    isHydrated,
    isLoading,
    deletingChatIds,
    unseenChatIds,

    // Actions
    startNewChat,
    selectChat,
    removeChat,
    renameChat,
    updateChatRepo,
    updateCurrentChat,
    updateChatById,
    sendMessage,
    stopAgent,
    updateSettings,
    addMessage,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Collect all descendant chat IDs for cascade delete
 */
function collectDescendantIds(
  chats: Array<{ id: string; parentChatId?: string }>,
  rootId: string
): string[] {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const chat of chats) {
      if (chat.parentChatId && ids.has(chat.parentChatId) && !ids.has(chat.id)) {
        ids.add(chat.id)
        changed = true
      }
    }
  }
  return Array.from(ids)
}
