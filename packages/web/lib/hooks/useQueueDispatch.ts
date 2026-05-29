"use client"

import { useCallback, useEffect, useRef } from "react"
import type { Chat, QueuedMessage } from "@/lib/types"
import { setQueuedMessages, setQueuePaused } from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useStreamStore } from "@/lib/stores/stream-store"
import {
  dequeue,
  enqueue,
  isChatReadyForQueueDispatch,
  removeFromQueue,
} from "@/lib/chat-state"

interface UseQueueDispatchOptions {
  isHydrated: boolean
  chats: Chat[]
  currentChat: Chat | null
  /** Per-chat queue, keyed by chatId. Owned by the chat-sync store. */
  queuedMessages: Record<string, QueuedMessage[] | undefined>
  /** Per-chat pause flag, keyed by chatId. Owned by the chat-sync store. */
  queuePaused: Record<string, boolean | undefined>
  /**
   * The underlying send. We don't await it here — fire-and-forget — but we do
   * use its returned promise to release the in-flight lock when it settles.
   */
  sendMessage: (
    content: string,
    agent?: string,
    model?: string,
    files?: File[],
    targetChatId?: string,
    planMode?: boolean
  ) => Promise<unknown> | unknown
  /**
   * True when the parent has a send already in flight for this chat. The parent
   * owns this state (a ref), so we just query through a predicate to avoid
   * leaking the ref.
   */
  isSendInFlight: (chatId: string) => boolean
  /** True when the parent has a stop in flight for this chat. Same shape as isSendInFlight. */
  isStopInFlight: (chatId: string) => boolean
}

interface UseQueueDispatchResult {
  /** Append a message to the *current chat's* queue and resume it. */
  enqueueMessage: (content: string, agent?: string, model?: string) => void
  /** Drop a queued message from the current chat's queue by id. */
  removeQueuedMessage: (id: string) => void
  /** Unpause the current chat's queue (auto-drain effect picks it back up). */
  resumeQueue: () => void
  /** Pause a chat's queue. Used by stopAgent when the user halts mid-stream. */
  pauseQueue: (chatId: string) => void
}

/**
 * Owns the per-chat outbound message queue and its auto-drain.
 *
 * Queues are client-owned: each chat has its own array of pending messages in
 * the local-state store (plus mirrored to localStorage so they survive reload).
 * When a chat finishes streaming and is otherwise idle, the next queued
 * message dispatches automatically via `sendMessage`.
 *
 * The auto-drain effect runs whenever `chats`, `queuedMessages`, or
 * `queuePaused` change, walking every chat with a non-empty unpaused queue and
 * calling `dispatchNextQueuedMessage`. Concurrent dispatches against the same
 * chat are prevented by an internal in-flight set.
 */
export function useQueueDispatch({
  isHydrated,
  chats,
  currentChat,
  queuedMessages,
  queuePaused,
  sendMessage,
  isSendInFlight,
  isStopInFlight,
}: UseQueueDispatchOptions): UseQueueDispatchResult {
  // Tracks which chats currently have a dispatch in flight. Local to this hook
  // because nothing outside the queue logic cares about it.
  const queueDispatchInFlight = useRef<Set<string>>(new Set())

  /**
   * Mirror a per-chat queue update into both localStorage and the in-memory
   * store. The two writes are paired everywhere we touch the queue, so doing
   * them in one helper avoids drift.
   */
  const writeQueue = useCallback(
    (chatId: string, queue: QueuedMessage[] | undefined) => {
      setQueuedMessages(chatId, queue)
      useChatSyncStore.getState().setLocalChatState((prev) => ({
        ...prev,
        queuedMessages: { ...prev.queuedMessages, [chatId]: queue },
      }))
    },
    []
  )

  /** Same shape as writeQueue but for the paused flag. */
  const writePaused = useCallback((chatId: string, paused: boolean) => {
    setQueuePaused(chatId, paused)
    useChatSyncStore.getState().setLocalChatState((prev) => ({
      ...prev,
      queuePaused: { ...prev.queuePaused, [chatId]: paused },
    }))
  }, [])

  /**
   * Pop the next queued message off `chatId` and dispatch it.
   * No-op when the chat is busy, paused, or already mid-dispatch.
   *
   * `queueOverride` lets the auto-drain caller pass in the queue value it just
   * confirmed was non-empty, avoiding a redundant lookup against potentially
   * stale React state.
   */
  const dispatchNextQueuedMessage = useCallback(
    (chatId: string, queueOverride?: QueuedMessage[]): boolean => {
      const chat = chats.find((c) => c.id === chatId)
      const queue = queueOverride ?? queuedMessages[chatId]
      if (!chat || !queue || queue.length === 0) return false
      // In-flight / stream locks are not pure state, so they're checked here.
      if (queueDispatchInFlight.current.has(chatId)) return false
      if (isSendInFlight(chatId)) return false
      if (isStopInFlight(chatId)) return false
      if (useStreamStore.getState().isStreaming(chatId)) return false
      if (!isChatReadyForQueueDispatch(chat, queue, queuePaused[chatId])) return false

      const { next: first, rest } = dequeue(queue)
      queueDispatchInFlight.current.add(chatId)
      writeQueue(chatId, rest.length > 0 ? rest : undefined)

      void Promise.resolve(
        sendMessage(first.content, first.agent, first.model, undefined, chatId)
      ).finally(() => {
        queueDispatchInFlight.current.delete(chatId)
      })

      return true
    },
    [
      chats,
      queuedMessages,
      queuePaused,
      sendMessage,
      isSendInFlight,
      isStopInFlight,
      writeQueue,
    ]
  )

  // Auto-drain: any time chats or queue state change, scan for chats with a
  // non-empty unpaused queue and dispatch their next message.
  useEffect(() => {
    if (!isHydrated) return

    for (const chat of chats) {
      const queue = queuedMessages[chat.id]
      const paused = queuePaused[chat.id]
      if (!queue || queue.length === 0 || paused) continue
      dispatchNextQueuedMessage(chat.id, queue)
    }
  }, [chats, dispatchNextQueuedMessage, isHydrated, queuedMessages, queuePaused])

  const enqueueMessage = useCallback(
    (content: string, agent?: string, model?: string) => {
      if (!currentChat) return
      const queued: QueuedMessage = { id: `q-${Date.now()}`, content, agent, model }
      const newQueue = enqueue(currentChat.queuedMessages, queued)
      writeQueue(currentChat.id, newQueue)
      // Enqueuing is also an implicit "unpause" — if you're adding to the queue,
      // you want it to drain.
      writePaused(currentChat.id, false)
    },
    [currentChat, writeQueue, writePaused]
  )

  const removeQueuedMessage = useCallback(
    (id: string) => {
      if (!currentChat) return
      writeQueue(currentChat.id, removeFromQueue(currentChat.queuedMessages, id))
    },
    [currentChat, writeQueue]
  )

  const resumeQueue = useCallback(() => {
    if (!currentChat?.queuePaused) return
    writePaused(currentChat.id, false)
  }, [currentChat, writePaused])

  const pauseQueue = useCallback(
    (chatId: string) => {
      writePaused(chatId, true)
    },
    [writePaused]
  )

  return {
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
    pauseQueue,
  }
}
