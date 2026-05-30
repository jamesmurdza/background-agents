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
import { notifyCompletion } from "@/lib/notify"
import type { SettingsData } from "@/lib/query/hooks/useSettingsQuery"
import { DEFAULT_SETTINGS } from "@/lib/storage"

const SSE_INITIAL_RETRY_DELAY = 1000
const SSE_MAX_RETRY_DELAY = 30000
const SSE_BACKOFF_MULTIPLIER = 1.5

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
  /** Called when a markdown file is written in plan mode, allowing the caller to open a preview */
  onMarkdownFileWrite?: ((chatId: string, filePath: string) => void) | null
}

export function useStreaming(options: UseStreamingOptions = {}) {
  const queryClient = useQueryClient()
  const onConflictStateChangeRef = useRef(options.onConflictStateChange)
  const onMarkdownFileWriteRef = useRef(options.onMarkdownFileWrite)

  // Keep refs updated
  onConflictStateChangeRef.current = options.onConflictStateChange
  onMarkdownFileWriteRef.current = options.onMarkdownFileWrite

  // Helper to update query cache
  const updateChatsCache = useCallback((updater: (chats: Chat[]) => Chat[]) => {
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old) => {
      if (!old) {
        console.warn("[SSE] updateChatsCache called but query data is undefined")
        return old
      }
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
    abortSignal?: AbortSignal,
    planMode?: boolean
  ) => {
    const streamStore = useStreamStore.getState()
    if (streamStore.isStreaming(chatId)) streamStore.stopStream(chatId)

    streamStore.startStream(chatId, { sandboxId, repoName, backgroundSessionId, previewUrlPattern, planMode })

    const connect = (cursor: number = 0) => {
      if (abortSignal?.aborted) {
        streamStore.stopStream(chatId)
        return
      }

      const currentStore = useStreamStore.getState()
      if (!currentStore.getStream(chatId)) return

      // IDOR fix: the server now derives sandboxId / backgroundSessionId /
      // previewUrlPattern / repoName from the chat row (which is auth-checked
      // for ownership), so we no longer pass them on the wire. Sending them
      // would only be misleading — they'd be silently ignored.
      const params = new URLSearchParams({ chatId, assistantMessageId })
      if (cursor > 0) params.set("cursor", cursor.toString())

      const eventSource = new EventSource(`/api/agent/stream?${params}`)
      currentStore.updateStream(chatId, { eventSource })

      abortSignal?.addEventListener("abort", () => {
        eventSource.close()
        useStreamStore.getState().stopStream(chatId)
      }, { once: true })

      // Track markdown files we've already opened to avoid duplicates
      const openedMarkdownFiles = new Set<string>()

      eventSource.addEventListener("update", (event) => {
        if (abortSignal?.aborted) return
        try {
          const data: SSEUpdateEvent = JSON.parse(event.data)
          const store = useStreamStore.getState()
          const stream = store.getStream(chatId)
          if (!stream) {
            console.warn("[SSE] Update received but stream was stopped for chat:", chatId)
            return
          }

          store.updateStream(chatId, { cursor: data.cursor, reconnectAttempts: 0 })

          // In plan mode, detect markdown file writes and open preview
          if (stream.connectionParams?.planMode && onMarkdownFileWriteRef.current) {
            for (const toolCall of data.toolCalls) {
              const tool = toolCall.tool?.toLowerCase()
              const filePath = (toolCall as { filePath?: string }).filePath
              if ((tool === "write" || tool === "edit") && filePath?.endsWith(".md")) {
                if (!openedMarkdownFiles.has(filePath)) {
                  openedMarkdownFiles.add(filePath)
                  onMarkdownFileWriteRef.current(chatId, filePath)
                }
              }
            }
          }

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

          // Raise notifications (native OS notification on desktop, in-app toast
          // on web), gated by the user's notification preferences.
          const settings =
            queryClient.getQueryData<SettingsData>(queryKeys.settings.all)?.settings ?? DEFAULT_SETTINGS
          const chatsCache = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())
          const notifyChat = chatsCache?.find((c) => c.id === chatId)

          // "Agent committed changes": the push advanced the remote (gated on
          // the push having happened, not the best-effort commit count).
          const committed = settings.notifyOnAgentCommitted && !!data.push
          // "Agent finished": the turn ended (completed or error).
          const finished = settings.notifyOnAgentFinished

          // Emit a SINGLE notification covering both facts. Firing two separate
          // OS notifications in the same tick makes macOS coalesce them, so the
          // second would silently replace the first.
          if (committed || finished) {
            const repo = notifyChat?.repo
            notifyCompletion({
              chatName: notifyChat?.displayName ?? undefined,
              status: data.status === "error" ? "error" : "completed",
              finished,
              push:
                committed && data.push
                  ? {
                      repo: repo && repo !== "__new__" ? repo : "",
                      branch: data.push.branch,
                      commits: data.push.commits,
                      commitSha: data.push.commitSha,
                    }
                  : undefined,
              chatId,
              sound: settings.notificationSound,
            })
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
          // This frame means the SSE stream itself failed (the route's poll loop
          // threw), not that the agent returned an error. The agent may still be
          // running in the background, so surface "disconnected" → Reload (refresh
          // chat history) rather than "error" → Retry (resend the message).
          updateChatsCache((old) => old.map((c) =>
            c.id === chatId ? { ...c, status: "disconnected", backgroundSessionId: undefined, errorMessage: data.error || "Connection to the agent was lost." } : c
          ))
        } catch {}
      })

      eventSource.onerror = async () => {
        if (abortSignal?.aborted) return
        eventSource.close()
        const store = useStreamStore.getState()
        const stream = store.getStream(chatId)
        if (!stream) return

        const failures = (stream.reconnectAttempts || 0) + 1
        store.updateStream(chatId, { reconnectAttempts: failures, eventSource: null })

        // Check if still streaming (user might have stopped)
        if (!useStreamStore.getState().isStreaming(chatId)) return

        // Check backend status IMMEDIATELY on SSE failure (no delay first)
        // This catches the case where agent finished right as we tried to connect
        try {
          const res = await fetch(`/api/chats/${chatId}?statusOnly=true`)
          if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
          const backendState = await res.json()

          if (backendState.status === "running" && backendState.backgroundSessionId) {
            // Agent still running - apply backoff then reconnect
            const delay = Math.min(
              SSE_INITIAL_RETRY_DELAY * Math.pow(SSE_BACKOFF_MULTIPLIER, failures - 1),
              SSE_MAX_RETRY_DELAY
            )
            await new Promise((r) => setTimeout(r, delay))

            if (useStreamStore.getState().isStreaming(chatId)) {
              connect(stream.cursor)
            }
          } else {
            // Agent actually done - sync local state with backend
            useStreamStore.getState().stopStream(chatId)
            updateChatsCache((old) =>
              old.map((c) =>
                c.id === chatId
                  ? { ...c, status: backendState.status, backgroundSessionId: undefined }
                  : c
              )
            )
          }
        } catch (err) {
          // Fetch failed (network still down) - apply backoff then retry
          console.warn(`[useStreaming] Backend status check failed for chat ${chatId}:`, err)
          const delay = Math.min(
            SSE_INITIAL_RETRY_DELAY * Math.pow(SSE_BACKOFF_MULTIPLIER, failures - 1),
            SSE_MAX_RETRY_DELAY
          )
          await new Promise((r) => setTimeout(r, delay))

          if (useStreamStore.getState().isStreaming(chatId)) {
            connect(stream.cursor)
          }
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
