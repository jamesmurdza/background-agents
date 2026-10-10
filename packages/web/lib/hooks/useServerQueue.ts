"use client"

import { useCallback, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Chat, QueuedMessage } from "@/lib/types"
import { getDefaultModelForAgent, type Agent } from "@background-agents/common"
import { queryKeys } from "@/lib/query"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useToastStore } from "@/lib/stores/toast-store"
import { setQueuedMessages, setQueuePaused } from "@/lib/storage"
import { applyQueueSnapshot, loadQueueMessages, needsQueueMessages, queueSyncFailure } from "@/lib/queue-sync"
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
}

function updateLocalQueue(chatId: string, update: (items: QueuedMessage[]) => QueuedMessage[]) {
  const previous = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
  let items = update(previous)
  try {
    items = setQueuedMessages(chatId, items.length ? items : undefined, previous)
  } catch (error) {
    // Still retain the prompt in memory and attempt the network send, but do
    // not promise it will survive closing the tab when device storage failed.
    console.error("Failed to persist the local prompt queue:", error)
    useToastStore.getState().addToast({ title: "Could not save on this device", body: "Keep this tab open until the prompt is saved on the server.", chatId })
  }
  useChatSyncStore.getState().setLocalChatState((prev) => ({
    ...prev, queuedMessages: { ...prev.queuedMessages, [chatId]: items.length ? items : undefined },
  }))
}

function markQueueFailure(chatId: string, id: string, error: unknown) {
  updateLocalQueue(chatId, (items) => items.map((item) => item.id === id ? { ...item, ...queueSyncFailure(error) } : item))
}

/**
 * Queue state belongs to the server. Old localStorage entries are retained only
 * until an idempotent import succeeds, so a network failure cannot silently
 * discard a user's pending prompt during the upgrade.
 */
export function useServerQueue({ isHydrated, isAuthenticated, currentChat }: UseServerQueueOptions) {
  const queryClient = useQueryClient()
  const migrating = useRef<Set<string>>(new Set())
  const enqueueTail = useRef<Map<string, Promise<void>>>(new Map())
  const refreshes = useRef<Map<string, Promise<Awaited<ReturnType<typeof fetchPromptQueue>>>>>(new Map())
  const resuming = useRef<Set<string>>(new Set())
  const checkedDirectRevision = useRef<Map<string, number>>(new Map())

  const refreshQueue = useCallback((chatId: string) => {
    const existing = refreshes.current.get(chatId)
    if (existing) return existing
    const task = (async () => {
      const remote = await fetchPromptQueue(chatId)
      const previous = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.find((chat) => chat.id === chatId)
      const next = { ...remote, backgroundSessionId: remote.backgroundSessionId ?? undefined, activeAssistantMessageId: remote.activeAssistantMessageId ?? undefined }
      const local = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
      const checkDirect = local.some((item) => item.directSend) && (remote.messageCount ?? 0) > 0 && checkedDirectRevision.current.get(chatId) !== (remote.updatedAt ?? -1)
      const detail = (checkDirect || needsQueueMessages(previous, next, local))
        ? await loadQueueMessages(chatId) : undefined
      if (checkDirect && detail) checkedDirectRevision.current.set(chatId, remote.updatedAt ?? -1)
      queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (chats) =>
        chats?.map((chat) => chat.id === chatId ? applyQueueSnapshot(chat, remote, detail) : chat)
      )
      return detail ? { ...remote, ...detail } : remote
    })()
    refreshes.current.set(chatId, task)
    void task.finally(() => { if (refreshes.current.get(chatId) === task) refreshes.current.delete(chatId) }).catch(() => {})
    return task
  }, [queryClient])

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
      let saved = false
      try {
        // Import individually so one permanently invalid saved entry cannot
        // poison every later entry in the batch. Retryable failures retain FIFO.
        // Cancellation has priority over importing/sending additional work.
        const pendingItems = [...queued.filter((item) => !item.directSend && item.cancelRequested), ...queued.filter((item) => !item.directSend && !item.cancelRequested)]
        for (const queuedItem of pendingItems) {
          let item = useChatSyncStore.getState().localChatState.queuedMessages[chatId]?.find((entry) => entry.id === queuedItem.id)
          if (!item || item.directSend || (item.syncFailed && !item.cancelRequested)) continue
          let acknowledged = false
          try {
            if (!item.cancelRequested) {
              const [imported] = await importLegacyPromptQueue(chatId, [{
                clientId: item.id, content: item.content, agent: item.agent, model: item.model,
              }], !!state.queuePaused[chatId])
              acknowledged = true
              updateLocalQueue(chatId, (items) => items.map((entry) => entry.id === item!.id ? {
                ...entry, userMessageId: imported?.userMessageId ?? entry.userMessageId,
                syncError: undefined, syncFailed: false,
              } : entry))
              item = useChatSyncStore.getState().localChatState.queuedMessages[chatId]?.find((entry) => entry.id === queuedItem.id)
              saved = true
            }
            // Removal may have been requested while the import was in flight.
            // Do not clear that durable intent until DELETE is acknowledged.
            if (item?.cancelRequested) {
              acknowledged = false
              await removeQueuedPromptApi(chatId, item.id, item.clientId ?? (item.pendingSync ? item.id : undefined))
              acknowledged = true
            }
            // An older refresh may already be in flight; it can predate POST.
            await refreshes.current.get(chatId)
            await refreshQueue(chatId)
            updateLocalQueue(chatId, (items) => items.filter((entry) =>
              entry.id !== queuedItem.id || (entry.cancelRequested && !item?.cancelRequested)))
          } catch (error) {
            // A failed history refresh does not mean an acknowledged POST or
            // DELETE failed. Keep its representation and retry the handoff.
            if (acknowledged) break
            markQueueFailure(chatId, queuedItem.id, error)
            if (item?.cancelRequested && queueSyncFailure(error).syncFailed) {
              // The server may already have started the turn. Surface that fact
              // instead of claiming cancellation or repeatedly issuing DELETE.
              updateLocalQueue(chatId, (items) => items.map((entry) => entry.id === queuedItem.id
                ? { ...entry, cancelRequested: false, cancelFailed: true } : entry))
              useToastStore.getState().addToast({ title: "Could not remove prompt", body: queueSyncFailure(error).syncError, chatId })
              await refreshQueue(chatId).catch(() => {})
            }
            if (!queueSyncFailure(error).syncFailed) break
          }
        }
        const rest = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
        if (!rest.length) {
          setQueuePaused(chatId, false)
          useChatSyncStore.getState().setLocalChatState((prev) => ({
            ...prev, queuePaused: { ...prev.queuePaused, [chatId]: false },
          }))
        }
        if (saved) wakeQueuedPrompt(chatId)
      } catch (error) {
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
      sendImmediately: currentChat.status === "ready" && !currentChat.backgroundSessionId && !currentChat.queuedMessages?.length,
    }
    // Persist locally before awaiting the network: closing the tab mid-request
    // still leaves a recoverable prompt for the idempotent import.
    updateLocalQueue(chatId, (items) => [...items, item])
    // Keep sends from this tab in the order the user submitted them, even if
    // the first HTTP request is slow. The database serializes the requests it
    // receives, but cannot know which of two concurrent requests was typed first.
    const previous = enqueueTail.current.get(chatId) ?? Promise.resolve()
    const task = previous.then(async () => {
      const pending = (useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? [])
        .filter((entry) => !entry.directSend && !entry.syncFailed && !entry.cancelRequested)
      const index = pending.findIndex((entry) => entry.id === item.id)
      if (index < 0) return // A migration already saved this item.
      if (index > 0) {
        // A previous request failed or is being imported. Import the local
        // snapshot in FIFO order rather than letting this item overtake it.
        await migrateLegacy()
        const remaining = (useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? [])
          .filter((entry) => !entry.directSend && !entry.syncFailed && !entry.cancelRequested)
        const remainingIndex = remaining.findIndex((entry) => entry.id === item.id)
        if (remainingIndex !== 0) return // Imported, or still waiting for retry.
      }
      const saved = await enqueuePromptApi(chatId, {
        clientId: item.id, content, agent: selectedAgent, model: selectedModel,
      })
      updateLocalQueue(chatId, (items) => items.map((entry) => entry.id === item.id
        ? { ...entry, userMessageId: saved.userMessageId, syncError: undefined, syncFailed: false } : entry))
      if (!useChatSyncStore.getState().localChatState.queuedMessages[chatId]?.find((entry) => entry.id === item.id)?.cancelRequested) {
        wakeQueuedPrompt(chatId)
      }
      await migrateLegacy()
    }).catch((error) => {
      markQueueFailure(chatId, item.id, error)
      console.error("Failed to save queued prompt; preserving its state on this device:", error)
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
    const displayed = currentChat.queuedMessages?.find((item) => item.id === id)
    const item = local.find((entry) => entry.id === id || entry.id === displayed?.clientId) ?? displayed
    if (!item || item.directSend) return
    const cancellation = { ...item, cancelRequested: true, cancelFailed: false, syncError: undefined, syncFailed: false }
    updateLocalQueue(chatId, (items) => items.some((entry) => entry.id === item.id)
      ? items.map((entry) => entry.id === item.id ? cancellation : entry)
      : [...items, cancellation])
    // Offline means pending cancellation, not success. The saved intent retries
    // after reconnect and cannot recreate a prompt through an enqueue call.
    void migrateLegacy()
  }, [currentChat, migrateLegacy])

  const resumeQueue = useCallback(async () => {
    if (!currentChat) return
    const chatId = currentChat.id
    if (resuming.current.has(chatId) || currentChat.status === "disconnected") return
    const recovery = currentChat.status === "error" && currentChat.recoverableAssistantMessageId
      ? { updatedAt: currentChat.updatedAt, assistantMessageId: currentChat.recoverableAssistantMessageId } : undefined
    if (currentChat.status === "error" && !recovery) return
    resuming.current.add(chatId)
    try {
      await setPromptQueuePaused(chatId, false, recovery)
      setQueuePaused(chatId, false)
      useChatSyncStore.getState().setLocalChatState((prev) => ({
        ...prev, queuePaused: { ...prev.queuePaused, [chatId]: false },
      }))
      // User intent releases only a confirmed terminal failure. Starting the
      // next stored prompt still uses the shared atomic FIFO claim.
      await dispatchQueuedPromptApi(chatId)
      await refreshQueue(chatId)
    } catch (error) {
      console.error("Failed to resume prompt queue:", error)
      useToastStore.getState().addToast({ title: "Could not continue queued prompts", body: error instanceof Error ? error.message : "Reload the chat and try again.", chatId })
      await refreshQueue(chatId).catch(() => {})
    } finally {
      resuming.current.delete(chatId)
    }
  }, [currentChat, refreshQueue])

  const pauseQueue = useCallback((chatId: string) => {
    void setPromptQueuePaused(chatId, true)
      .then(() => refreshQueue(chatId))
      .catch((error) => console.error("Failed to pause prompt queue:", error))
  }, [refreshQueue])

  return { enqueueMessage, removeQueuedMessage, resumeQueue, pauseQueue }
}
