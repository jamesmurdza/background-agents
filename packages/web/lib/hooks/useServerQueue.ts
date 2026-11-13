"use client"

import { useCallback, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Chat, QueuedMessage } from "@/lib/types"
import { getDefaultModelForAgent, type Agent } from "@background-agents/common"
import { queryKeys } from "@/lib/query"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useToastStore } from "@/lib/stores/toast-store"
import { applyQueueSnapshot, loadQueueMessages, needsQueueMessages, withoutMessageProgress } from "@/lib/queue-sync"
import { useStreamStore } from "@/lib/stores/stream-store"
import {
  dispatchQueuedPromptApi,
  enqueuePromptApi,
  fetchPromptQueue,
  removeQueuedPromptApi,
  setPromptQueuePaused,
} from "@/lib/sync/api"

interface UseServerQueueOptions {
  isHydrated: boolean
  isAuthenticated: boolean
  currentChat: Chat | null
}

function updateLocalQueue(chatId: string, update: (items: QueuedMessage[]) => QueuedMessage[]) {
  useChatSyncStore.getState().setLocalChatState((prev) => {
    const items = update(prev.queuedMessages[chatId] ?? [])
    return { ...prev, queuedMessages: { ...prev.queuedMessages, [chatId]: items.length ? items : undefined } }
  })
}

/** SSE is already delivering this turn's reply, so the poll needn't read it from the DB. */
function isStreamingTurn(chatId: string, remote: { status: Chat["status"]; activeAssistantMessageId: string | null }) {
  const stream = useStreamStore.getState()
  return remote.status === "running" && !!remote.activeAssistantMessageId && stream.isStreaming(chatId) &&
    stream.getStream(chatId)?.connectionParams?.assistantMessageId === remote.activeAssistantMessageId
}

function localItem(chatId: string, id: string) {
  return useChatSyncStore.getState().localChatState.queuedMessages[chatId]?.find((entry) => entry.id === id)
}

/** Put an unsent prompt back in the composer, ahead of anything typed since. */
function restoreDraft(chatId: string, content: string) {
  const store = useChatSyncStore.getState()
  const newerDraft = store.localChatState.drafts[chatId]
  store.setDraftText(chatId, newerDraft ? `${content}\n\n${newerDraft}` : content)
}

/**
 * Queue state belongs to the server. A prompt is kept in this tab only while
 * it's being saved; if saving fails, it goes back to the composer.
 */
export function useServerQueue({ isHydrated, isAuthenticated, currentChat }: UseServerQueueOptions) {
  const queryClient = useQueryClient()
  const enqueueTail = useRef<Map<string, Promise<void>>>(new Map())
  const refreshes = useRef<Map<string, Promise<Awaited<ReturnType<typeof fetchPromptQueue>>>>>(new Map())
  const resuming = useRef<Set<string>>(new Set())

  const refreshQueue = useCallback((chatId: string) => {
    const existing = refreshes.current.get(chatId)
    if (existing) return existing
    const task = (async () => {
      const remote = await fetchPromptQueue(chatId)
      const previous = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.find((chat) => chat.id === chatId)
      const next = { ...remote, backgroundSessionId: remote.backgroundSessionId ?? undefined, activeAssistantMessageId: remote.activeAssistantMessageId ?? undefined }
      const local = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
      // Skipped reads keep the old counters, so the first poll after the
      // stream ends still fetches anything SSE doesn't carry (e.g. git messages).
      const streaming = isStreamingTurn(chatId, remote)
      const detail = !streaming && needsQueueMessages(previous, next, local) ? await loadQueueMessages(chatId, previous) : undefined
      const snapshot = streaming ? withoutMessageProgress(remote) : remote
      queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (chats) =>
        chats?.map((chat) => chat.id === chatId ? applyQueueSnapshot(chat, snapshot, detail) : chat)
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

  const enqueueMessage = useCallback((content: string, agent?: string, model?: string, reasoningEffort?: string) => {
    if (!currentChat || currentChat.id.startsWith("draft-")) return
    const chatId = currentChat.id
    const selectedAgent = agent ?? currentChat.agent ?? "opencode"
    const selectedModel = model ?? currentChat.model ?? getDefaultModelForAgent(selectedAgent as Agent, null)
    const item: QueuedMessage = {
      id: crypto.randomUUID(), content, agent: selectedAgent, model: selectedModel, reasoningEffort, pendingSync: true,
      sendImmediately: currentChat.status === "ready" && !currentChat.backgroundSessionId && !currentChat.queuedMessages?.length,
    }
    updateLocalQueue(chatId, (items) => [...items, item])
    // Keep sends from this tab in the order the user submitted them, even if
    // the first HTTP request is slow. The database serializes the requests it
    // receives, but cannot know which of two concurrent requests was typed first.
    const previous = enqueueTail.current.get(chatId) ?? Promise.resolve()
    const task = previous.then(async () => {
      if (!localItem(chatId, item.id)) return // Removed before it was sent.
      let saved: QueuedMessage
      try {
        saved = await enqueuePromptApi(chatId, {
          clientId: item.id, content, agent: selectedAgent, model: selectedModel, reasoningEffort,
        })
      } catch (error) {
        console.error("[queue] Failed to save queued prompt:", error)
        // A lost response can still have saved it. Check the queue once before
        // handing the text back; if we can't check, say so.
        const queue = await refreshQueue(chatId).catch(() => undefined)
        const removed = !localItem(chatId, item.id)
        updateLocalQueue(chatId, (items) => items.filter((entry) => entry.id !== item.id))
        if (removed || queue?.queuedMessages.some((queued) => queued.clientId === item.id)) return
        restoreDraft(chatId, content)
        useToastStore.getState().addToast({
          title: "Could not queue your prompt",
          body: queue ? "It's back in the message box so you can send it again." : "It's back in the message box. Check the queue before sending it again.",
          chatId,
        })
        return
      }
      updateLocalQueue(chatId, (items) => items.map((entry) => entry.id === item.id ? { ...entry, userMessageId: saved.userMessageId } : entry))
      wakeQueuedPrompt(chatId)
      // Load the server copy before dropping ours so the prompt never blinks out.
      // If that read fails, the next poll's server copy hides ours instead.
      try {
        await refreshQueue(chatId)
        updateLocalQueue(chatId, (items) => items.filter((entry) => entry.id !== item.id))
      } catch (error) {
        console.error("[queue] Failed to refresh after saving a prompt:", error)
      }
    }).catch((error) => {
      // Keep the chain alive so later prompts from this tab still go out.
      console.error("[queue] Unexpected error while queueing a prompt:", error)
    })
    enqueueTail.current.set(chatId, task)
    void task.finally(() => {
      if (enqueueTail.current.get(chatId) === task) enqueueTail.current.delete(chatId)
    })
  }, [currentChat, refreshQueue, wakeQueuedPrompt])

  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return
    const chatId = currentChat.id
    const local = localItem(chatId, id)
    const item = local ?? currentChat.queuedMessages?.find((entry) => entry.id === id)
    if (!item) return
    // A prompt still being saved is removed by its client ID. The server keeps
    // that as a tombstone, so a POST still in flight can't add it back.
    if (local) updateLocalQueue(chatId, (items) => items.filter((entry) => entry.id !== id))
    void removeQueuedPromptApi(chatId, item.id, item.clientId ?? (local ? item.id : undefined))
      .then(() => refreshQueue(chatId))
      .catch((error) => {
        console.error("[queue] Failed to remove queued prompt:", error)
        useToastStore.getState().addToast({ title: "Could not remove prompt", body: error instanceof Error ? error.message : "Try again.", chatId })
        void refreshQueue(chatId).catch(() => {})
      })
  }, [currentChat, refreshQueue])

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
