"use client"

/**
 * useStreaming - SSE streaming logic for agent responses
 *
 * Handles SSE connection, reconnection, and message updates.
 * Extracted from useChatWithSync for modularity.
 */

import { useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Chat, Message, SSEUpdateEvent, SSECompleteEvent } from "@/lib/types"
import { useStreamStore } from "@/lib/stores/stream-store"
import { queryKeys } from "@/lib/query"
import { fetchChat, toMessageType } from "@/lib/sync/api"

const SSE_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_ATTEMPTS = 10

/**
 * Merge messages, preferring the one with more content.
 */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const messageMap = new Map<string, Message>()

  for (const msg of existing) {
    messageMap.set(msg.id, msg)
  }

  for (const incomingMsg of incoming) {
    const existingMsg = messageMap.get(incomingMsg.id)
    if (!existingMsg) {
      messageMap.set(incomingMsg.id, incomingMsg)
    } else {
      const existingLen = (existingMsg.content?.length ?? 0) +
        (existingMsg.toolCalls?.length ?? 0) +
        (existingMsg.contentBlocks?.length ?? 0)
      const incomingLen = (incomingMsg.content?.length ?? 0) +
        (incomingMsg.toolCalls?.length ?? 0) +
        (incomingMsg.contentBlocks?.length ?? 0)

      if (incomingLen > existingLen) {
        messageMap.set(incomingMsg.id, incomingMsg)
      } else if (incomingLen === existingLen && incomingMsg.timestamp > existingMsg.timestamp) {
        messageMap.set(incomingMsg.id, incomingMsg)
      }
    }
  }

  return Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp)
}

interface UseStreamingOptions {
  onConflictStateChange?: ((state: { inRebase: boolean; inMerge: boolean; conflictedFiles: string[] }) => void) | null
}

export function useStreaming(options: UseStreamingOptions = {}) {
  const queryClient = useQueryClient()
  const onConflictStateChangeRef = useRef(options.onConflictStateChange)

  // Keep ref updated
  onConflictStateChangeRef.current = options.onConflictStateChange

  // Helper to update query cache
  const updateChatsCache = useCallback((updater: (chats: Chat[]) => Chat[]) => {
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old) => {
      if (!old) return old
      return updater(old)
    })
  }, [queryClient])

  // Start streaming for a chat
  const startStreaming = useCallback((
    chatId: string,
    sandboxId: string,
    repoName: string,
    backgroundSessionId: string,
    assistantMessageId: string,
    previewUrlPattern?: string,
    branch?: string | null,
    abortSignal?: AbortSignal
  ) => {
    const streamStore = useStreamStore.getState()
    if (streamStore.isStreaming(chatId)) streamStore.stopStream(chatId)

    streamStore.startStream(chatId, { sandboxId, repoName, backgroundSessionId, previewUrlPattern })

    const connect = (cursor: number = 0) => {
      if (abortSignal?.aborted) {
        streamStore.stopStream(chatId)
        return
      }

      const currentStore = useStreamStore.getState()
      if (!currentStore.getStream(chatId)) return

      const params = new URLSearchParams({ sandboxId, repoName, backgroundSessionId, chatId, assistantMessageId })
      if (previewUrlPattern) params.set("previewUrlPattern", previewUrlPattern)
      if (cursor > 0) params.set("cursor", cursor.toString())

      const eventSource = new EventSource(`/api/agent/stream?${params}`)
      currentStore.updateStream(chatId, { eventSource })

      abortSignal?.addEventListener("abort", () => {
        eventSource.close()
        useStreamStore.getState().stopStream(chatId)
      }, { once: true })

      eventSource.addEventListener("update", (event) => {
        if (abortSignal?.aborted) return
        try {
          const data: SSEUpdateEvent = JSON.parse(event.data)
          const store = useStreamStore.getState()
          if (!store.isStreaming(chatId)) return

          store.updateStream(chatId, { cursor: data.cursor, reconnectAttempts: 0 })

          updateChatsCache((old) => old.map((c) => {
            if (c.id !== chatId) return c
            const messages = [...c.messages]
            const lastIndex = messages.length - 1
            if (lastIndex >= 0) {
              messages[lastIndex] = { ...messages[lastIndex], content: data.content, toolCalls: data.toolCalls, contentBlocks: data.contentBlocks }
            }
            return { ...c, messages }
          }))
        } catch (err) {
          console.error("Failed to parse SSE update:", err)
        }
      })

      eventSource.addEventListener("complete", async (event) => {
        if (abortSignal?.aborted) return
        try {
          const data: SSECompleteEvent = JSON.parse(event.data)
          useStreamStore.getState().stopStream(chatId)

          // Clear backgroundSessionId and update status
          updateChatsCache((old) => old.map((c) =>
            c.id === chatId ? {
              ...c,
              backgroundSessionId: undefined,
              status: data.status === "error" ? "error" : "ready",
              lastActiveAt: Date.now(),
              errorMessage: data.status === "error" ? (data.error || "Agent failed") : undefined,
              sessionId: data.sessionId ?? c.sessionId,
            } : c
          ))

          // Notify about conflict state change
          if (data.conflictState && onConflictStateChangeRef.current) {
            onConflictStateChangeRef.current(data.conflictState)
          }

          // Fetch any new messages created by the backend (delta sync)
          try {
            const chatData = await fetchChat(chatId, { afterMessageId: assistantMessageId })
            const incomingMessages = chatData.messages.map(toMessageType)
            if (incomingMessages.length > 0) {
              updateChatsCache((old) =>
                old.map((c) => {
                  if (c.id !== chatId) return c
                  return { ...c, messages: mergeMessages(c.messages, incomingMessages) }
                })
              )
            }
          } catch (fetchErr) {
            console.error("Failed to fetch new messages after stream complete:", fetchErr)
          }
        } catch (err) {
          console.error("Failed to parse SSE complete:", err)
        }
      })

      eventSource.addEventListener("heartbeat", (event) => {
        if (abortSignal?.aborted) return
        try {
          const data = JSON.parse(event.data)
          const store = useStreamStore.getState()
          if (store.isStreaming(chatId)) {
            store.updateStream(chatId, { cursor: data.cursor, reconnectAttempts: 0 })
          }
        } catch {}
      })

      eventSource.addEventListener("error", (event) => {
        if (abortSignal?.aborted) return
        try {
          const data = JSON.parse((event as MessageEvent).data)
          useStreamStore.getState().stopStream(chatId)
          updateChatsCache((old) => old.map((c) =>
            c.id === chatId ? { ...c, status: "error", backgroundSessionId: undefined, errorMessage: data.error || "Agent stream failed" } : c
          ))
        } catch {}
      })

      eventSource.onerror = () => {
        if (abortSignal?.aborted) return
        eventSource.close()
        const store = useStreamStore.getState()
        const stream = store.getStream(chatId)
        if (!stream) return

        const attempts = (stream.reconnectAttempts || 0) + 1
        if (attempts <= SSE_MAX_RECONNECT_ATTEMPTS) {
          store.updateStream(chatId, { reconnectAttempts: attempts, eventSource: null })
          setTimeout(() => {
            if (useStreamStore.getState().isStreaming(chatId)) connect(stream.cursor)
          }, SSE_RECONNECT_DELAY)
        } else {
          store.stopStream(chatId)
          updateChatsCache((old) => old.map((c) =>
            c.id === chatId && c.status === "running"
              ? { ...c, status: "ready", backgroundSessionId: undefined }
              : c
          ))
        }
      }
    }

    connect()
  }, [updateChatsCache])

  return {
    startStreaming,
    updateChatsCache,
    mergeMessages,
  }
}
