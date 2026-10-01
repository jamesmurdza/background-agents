"use client"

import { useCallback, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Chat, QueuedMessage } from "@/lib/types"
import { getDefaultModelForAgent, type Agent } from "@background-agents/common"
import { queryKeys } from "@/lib/query"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { setQueuedMessages, setQueuePaused } from "@/lib/storage"
import {
  dispatchQueuedPromptApi,
  enqueuePromptApi,
  fetchPromptQueue,
  importLegacyPromptQueue,
  removeQueuedPromptApi,
  setPromptQueuePaused,
} from "@/lib/sync/api"

interface UseServerQueueOptions {
  isHydrated: boolean
  isAuthenticated: boolean
  currentChat: Chat | null
  reloadMessages: (chatId: string) => Promise<void>
}

/**
 * Queue state belongs to the server. Old localStorage entries are retained only
 * until an idempotent import succeeds, so a network failure cannot silently
 * discard a user's pending prompt during the upgrade.
 */
export function useServerQueue({ isHydrated, isAuthenticated, currentChat, reloadMessages }: UseServerQueueOptions) {
  const queryClient = useQueryClient()
  const migrating = useRef<Set<string>>(new Set())
  const enqueueTail = useRef<Map<string, Promise<void>>>(new Map())

  const refreshQueue = useCallback(async (chatId: string) => {
    const remote = await fetchPromptQueue(chatId)
    const previous = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.find((chat) => chat.id === chatId)
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (chats) =>
      chats?.map((chat) => chat.id === chatId ? {
        ...chat,
        queuedMessages: remote.queuedMessages,
        queuePaused: remote.queuePaused,
        status: remote.status,
        sandboxId: remote.sandboxId,
        backgroundSessionId: remote.backgroundSessionId ?? undefined,
        activeAssistantMessageId: remote.activeAssistantMessageId ?? undefined,
      } : chat)
    )
    // A worker may have started a turn without any browser. Load its persisted
    // user/assistant rows so the existing streaming resume effect can attach.
    if (remote.backgroundSessionId && remote.activeAssistantMessageId && (
      remote.backgroundSessionId !== previous?.backgroundSessionId ||
      !previous?.messages.some((message) => message.id === remote.activeAssistantMessageId)
    )) {
      await reloadMessages(chatId)
    }
    return remote
  }, [queryClient, reloadMessages])

  const wakeQueuedPrompt = useCallback((chatId: string) => {
    void dispatchQueuedPromptApi(chatId)
      .then(() => refreshQueue(chatId))
      .catch((error) => console.error("Failed to wake queued prompt:", error))
  }, [refreshQueue])

  useEffect(() => {
    const chatId = currentChat?.id
    if (!isHydrated || !isAuthenticated || !chatId || chatId.startsWith("draft-")) return
    const syncAndWake = async () => {
      const queue = await refreshQueue(chatId)
      // Covers a tab opened after the completion event: it did not receive SSE,
      // but can still wake persisted work instead of waiting for the cron.
      if (queue.status === "ready" && !queue.queuePaused && !queue.backgroundSessionId && queue.queuedMessages.length > 0) {
        wakeQueuedPrompt(chatId)
      }
    }
    void syncAndWake().catch((error) => console.error("Failed to sync prompt queue:", error))
    const timer = window.setInterval(() => {
      void syncAndWake().catch((error) => console.error("Failed to sync prompt queue:", error))
    }, 5000)
    return () => window.clearInterval(timer)
  }, [currentChat?.id, isHydrated, isAuthenticated, refreshQueue, wakeQueuedPrompt])

  const migrateLegacy = useCallback(async () => {
    const state = useChatSyncStore.getState().localChatState
    for (const [chatId, queued] of Object.entries(state.queuedMessages)) {
      if (!queued?.length || chatId.startsWith("draft-") || migrating.current.has(chatId)) continue
      migrating.current.add(chatId)
      const snapshot = queued
      try {
        for (let offset = 0; offset < snapshot.length; offset += 50) {
          await importLegacyPromptQueue(
            chatId,
            snapshot.slice(offset, offset + 50).map((item) => ({
              clientId: item.id,
              content: item.content,
              agent: item.agent,
              model: item.model,
            })),
            !!state.queuePaused[chatId]
          )
        }
        const latest = useChatSyncStore.getState().localChatState
        const migratedIds = new Set(snapshot.map((item) => item.id))
        const rest = (latest.queuedMessages[chatId] ?? []).filter((item) => !migratedIds.has(item.id))
        setQueuedMessages(chatId, rest.length ? rest : undefined)
        useChatSyncStore.getState().setLocalChatState((prev) => ({
          ...prev,
          queuedMessages: { ...prev.queuedMessages, [chatId]: rest.length ? rest : undefined },
        }))
        if (!rest.length) {
          setQueuePaused(chatId, false)
          useChatSyncStore.getState().setLocalChatState((prev) => ({
            ...prev, queuePaused: { ...prev.queuePaused, [chatId]: false },
          }))
        }
        await refreshQueue(chatId)
        wakeQueuedPrompt(chatId)
      } catch (error) {
        // The local copy remains visible as pendingSync and retries later.
        console.error(`Failed to import saved prompt queue for ${chatId}:`, error)
      } finally {
        migrating.current.delete(chatId)
      }
    }
  }, [refreshQueue, wakeQueuedPrompt])

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return
    void migrateLegacy()
    const timer = window.setInterval(() => void migrateLegacy(), 15000)
    return () => window.clearInterval(timer)
  }, [isHydrated, isAuthenticated, migrateLegacy])

  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChat || currentChat.id.startsWith("draft-")) return
    const chatId = currentChat.id
    const selectedAgent = agent ?? currentChat.agent ?? "opencode"
    const selectedModel = model ?? currentChat.model ?? getDefaultModelForAgent(selectedAgent as Agent, null)
    const item: QueuedMessage = {
      id: crypto.randomUUID(), content, agent: selectedAgent, model: selectedModel, pendingSync: true,
    }
    // Persist locally before awaiting the network: closing the tab mid-request
    // still leaves a recoverable prompt for the idempotent import.
    const state = useChatSyncStore.getState().localChatState
    const localQueue = [...(state.queuedMessages[chatId] ?? []), item]
    setQueuedMessages(chatId, localQueue)
    useChatSyncStore.getState().setLocalChatState((prev) => ({
      ...prev,
      queuedMessages: { ...prev.queuedMessages, [chatId]: localQueue },
    }))
    // Keep sends from this tab in the order the user submitted them, even if
    // the first HTTP request is slow. The database serializes the requests it
    // receives, but cannot know which of two concurrent requests was typed first.
    const previous = enqueueTail.current.get(chatId) ?? Promise.resolve()
    const task = previous.then(async () => {
      const pending = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
      const index = pending.findIndex((entry) => entry.id === item.id)
      if (index < 0) return // A migration already saved this item.
      if (index > 0) {
        // A previous request failed or is being imported. Import the local
        // snapshot in FIFO order rather than letting this item overtake it.
        await migrateLegacy()
        const remaining = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
        const remainingIndex = remaining.findIndex((entry) => entry.id === item.id)
        if (remainingIndex !== 0) return // Imported, or still waiting for retry.
      }
      await enqueuePromptApi(chatId, {
        clientId: item.id, content, agent: selectedAgent, model: selectedModel,
      })
      wakeQueuedPrompt(chatId)
      await migrateLegacy()
    }).catch((error) => {
      console.error("Failed to save queued prompt; keeping it on this device for retry:", error)
    })
    enqueueTail.current.set(chatId, task)
    void task.finally(() => {
      if (enqueueTail.current.get(chatId) === task) enqueueTail.current.delete(chatId)
    })
  }, [currentChat, migrateLegacy, wakeQueuedPrompt])

  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return
    const chatId = currentChat.id
    const local = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
    if (local.some((item) => item.id === id)) {
      const item = local.find((entry) => entry.id === id)!
      const rest = local.filter((item) => item.id !== id)
      setQueuedMessages(chatId, rest.length ? rest : undefined)
      useChatSyncStore.getState().setLocalChatState((prev) => ({
        ...prev, queuedMessages: { ...prev.queuedMessages, [chatId]: rest.length ? rest : undefined },
      }))
      // The POST may already be in flight. Resolve its stable client ID, then
      // cancel the server row too so it cannot reappear on the next refresh.
      const selectedAgent = item.agent ?? currentChat.agent ?? "opencode"
      const selectedModel = item.model ?? currentChat.model ?? getDefaultModelForAgent(selectedAgent as Agent, null)
      void enqueuePromptApi(chatId, {
        clientId: item.id, content: item.content, agent: selectedAgent, model: selectedModel,
      }).then((queuedMessage) => removeQueuedPromptApi(chatId, queuedMessage.id))
        .then(() => refreshQueue(chatId))
        .catch((error) => console.error("Failed to remove pending queued prompt:", error))
      return
    }
    void removeQueuedPromptApi(chatId, id)
      .then(() => refreshQueue(chatId))
      .catch((error) => console.error("Failed to remove queued prompt:", error))
  }, [currentChat, refreshQueue])

  const resumeQueue = useCallback(() => {
    if (!currentChat) return
    const chatId = currentChat.id
    setQueuePaused(chatId, false)
    useChatSyncStore.getState().setLocalChatState((prev) => ({
      ...prev, queuePaused: { ...prev.queuePaused, [chatId]: false },
    }))
    void setPromptQueuePaused(chatId, false)
      .then(() => {
        wakeQueuedPrompt(chatId)
        return refreshQueue(chatId)
      })
      .catch((error) => console.error("Failed to resume prompt queue:", error))
  }, [currentChat, refreshQueue, wakeQueuedPrompt])

  const pauseQueue = useCallback((chatId: string) => {
    void setPromptQueuePaused(chatId, true)
      .then(() => refreshQueue(chatId))
      .catch((error) => console.error("Failed to pause prompt queue:", error))
  }, [refreshQueue])

  return { enqueueMessage, removeQueuedMessage, resumeQueue, pauseQueue }
}
