/**
 * Stream Store - SSE Connection Lifecycle Management
 *
 * Owns the full EventSource lifecycle for each chat:
 * - Creating connections
 * - Handling update/complete/error events
 * - Reconnection with exponential backoff
 * - Writing streaming content directly to query cache
 *
 * The store owns connections, not data — all content goes to TanStack Query cache.
 */

import { create } from "zustand"
import type { SSEUpdateEvent, SSECompleteEvent, Chat } from "@/lib/types"
import {
  updateMessageInCache,
  markStreamComplete,
  markStreamError,
} from "@/lib/queries/cache-updates"

// =============================================================================
// Constants
// =============================================================================

const SSE_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_ATTEMPTS = 10

// =============================================================================
// Types
// =============================================================================

export interface StreamConnectionParams {
  sandboxId: string
  repoName: string
  backgroundSessionId: string
  assistantMessageId: string
  previewUrlPattern?: string
}

export interface StreamState {
  /** The SSE EventSource connection */
  eventSource: EventSource | null
  /** Cursor position for reconnection */
  cursor: number
  /** Number of reconnection attempts */
  reconnectAttempts: number
  /** Connection parameters for reconnection */
  connectionParams: StreamConnectionParams | null
  /** AbortController signal for cleanup */
  abortController: AbortController | null
}

export interface StreamStore {
  /** Map of chatId -> stream state */
  streams: Map<string, StreamState>

  /**
   * Connect and start streaming for a chat
   *
   * Creates the EventSource and wires up all handlers.
   * Writes streaming content directly to query cache.
   *
   * @param chatId - The chat to stream for
   * @param params - Connection parameters
   * @param options.onComplete - Optional callback when stream completes
   */
  connect: (
    chatId: string,
    params: StreamConnectionParams,
    options?: {
      onComplete?: (data: SSECompleteEvent) => void
    }
  ) => void

  /** Disconnect and clean up a stream */
  disconnect: (chatId: string) => void

  /** Update stream state (internal use) */
  updateStream: (chatId: string, updates: Partial<StreamState>) => void

  /** Get stream state for a chat */
  getStream: (chatId: string) => StreamState | undefined

  /** Check if a chat is currently streaming */
  isStreaming: (chatId: string) => boolean

  /**
   * Ensure streams exist for chats that need them
   *
   * Called during hydration recovery to reconnect to running chats.
   * Only opens connections for chats that need one and aren't already connected.
   *
   * @param chats - List of chats to check
   * @param getAssistantMessageId - Function to get the last assistant message ID for a chat
   */
  ensureStreamsFor: (
    chats: Array<Pick<Chat, "id" | "sandboxId" | "backgroundSessionId" | "previewUrlPattern" | "messages">>,
    getAssistantMessageId?: (chat: Pick<Chat, "messages">) => string | undefined
  ) => void

  // Legacy compatibility (used by existing code during migration)
  /** @deprecated Use connect() instead */
  startStream: (chatId: string, params: Omit<StreamConnectionParams, "assistantMessageId">) => void
  /** @deprecated Use disconnect() instead */
  stopStream: (chatId: string) => void
}

// =============================================================================
// Helpers
// =============================================================================

const createEmptyStreamState = (): StreamState => ({
  eventSource: null,
  cursor: 0,
  reconnectAttempts: 0,
  connectionParams: null,
  abortController: null,
})

// =============================================================================
// Store Implementation
// =============================================================================

export const useStreamStore = create<StreamStore>((set, get) => {
  /**
   * Internal: Create EventSource and wire up handlers
   */
  const createConnection = (
    chatId: string,
    params: StreamConnectionParams,
    cursor: number,
    abortSignal: AbortSignal,
    onComplete?: (data: SSECompleteEvent) => void
  ) => {
    // Check if aborted before connecting
    if (abortSignal.aborted) {
      get().disconnect(chatId)
      return
    }

    const currentStore = get()
    const streamState = currentStore.getStream(chatId)
    if (!streamState) return

    // Build URL with parameters
    const urlParams = new URLSearchParams({
      sandboxId: params.sandboxId,
      repoName: params.repoName,
      backgroundSessionId: params.backgroundSessionId,
      chatId,
      assistantMessageId: params.assistantMessageId,
    })
    if (params.previewUrlPattern) {
      urlParams.set("previewUrlPattern", params.previewUrlPattern)
    }
    if (cursor > 0) {
      urlParams.set("cursor", cursor.toString())
    }

    const eventSource = new EventSource(`/api/agent/stream?${urlParams}`)
    currentStore.updateStream(chatId, { eventSource })

    // Close EventSource when abort signal fires
    const abortHandler = () => {
      eventSource.close()
      get().disconnect(chatId)
    }
    abortSignal.addEventListener("abort", abortHandler)

    // Handle "update" events - streaming content
    eventSource.addEventListener("update", (event) => {
      if (abortSignal.aborted) return

      try {
        const data: SSEUpdateEvent = JSON.parse(event.data)
        const store = get()
        if (!store.isStreaming(chatId)) return

        // Update stream state (cursor, reset reconnect attempts)
        store.updateStream(chatId, {
          cursor: data.cursor,
          reconnectAttempts: 0,
        })

        // Write content to query cache
        updateMessageInCache(chatId, params.assistantMessageId, {
          content: data.content,
          toolCalls: data.toolCalls,
          contentBlocks: data.contentBlocks,
        })
      } catch (err) {
        console.error("Failed to parse SSE update:", err)
      }
    })

    // Handle "complete" events - stream finished
    eventSource.addEventListener("complete", (event) => {
      if (abortSignal.aborted) return

      try {
        const data: SSECompleteEvent = JSON.parse(event.data)

        // Clean up connection
        get().disconnect(chatId)

        // Update query cache
        markStreamComplete(chatId, data)

        // Call completion callback if provided
        onComplete?.(data)
      } catch (err) {
        console.error("Failed to parse SSE complete:", err)
      }
    })

    // Handle "heartbeat" events - keep-alive
    eventSource.addEventListener("heartbeat", (event) => {
      if (abortSignal.aborted) return

      try {
        const data = JSON.parse(event.data)
        const store = get()
        if (store.isStreaming(chatId)) {
          store.updateStream(chatId, {
            cursor: data.cursor,
            reconnectAttempts: 0,
          })
        }
      } catch (err) {
        console.error("Failed to parse heartbeat:", err)
      }
    })

    // Handle "error" events - server-side errors
    eventSource.addEventListener("error", (event) => {
      if (abortSignal.aborted) return

      try {
        const data = JSON.parse((event as MessageEvent).data)
        console.error("SSE error:", data.error)

        get().disconnect(chatId)

        const errorMessage = data.error || "Agent stream failed without an error message"
        markStreamError(chatId, errorMessage)
      } catch {
        // Connection error - handled by onerror
      }
    })

    // Handle connection errors - attempt reconnect
    eventSource.onerror = () => {
      if (abortSignal.aborted) return

      eventSource.close()
      abortSignal.removeEventListener("abort", abortHandler)

      const store = get()
      const stream = store.getStream(chatId)
      if (!stream) return

      const attempts = (stream.reconnectAttempts || 0) + 1
      if (attempts <= SSE_MAX_RECONNECT_ATTEMPTS) {
        // Update attempts and clear eventSource
        store.updateStream(chatId, {
          reconnectAttempts: attempts,
          eventSource: null,
        })

        // Reconnect after delay
        setTimeout(() => {
          const currentState = get()
          if (currentState.isStreaming(chatId) && stream.connectionParams) {
            createConnection(
              chatId,
              stream.connectionParams,
              stream.cursor,
              abortSignal,
              onComplete
            )
          }
        }, SSE_RECONNECT_DELAY)
      } else {
        // Max attempts reached - give up
        store.disconnect(chatId)

        // Update status to ready (not error, as the agent may have completed)
        markStreamComplete(chatId, { status: "completed", cursor: stream.cursor })
      }
    }
  }

  return {
    streams: new Map(),

    connect: (chatId, params, options) => {
      // Close existing stream if any
      const existing = get().streams.get(chatId)
      if (existing?.eventSource) {
        existing.eventSource.close()
      }
      if (existing?.abortController) {
        existing.abortController.abort()
      }

      // Create new abort controller
      const abortController = new AbortController()

      // Initialize stream state
      set((state) => {
        const streams = new Map(state.streams)
        streams.set(chatId, {
          ...createEmptyStreamState(),
          connectionParams: params,
          abortController,
        })
        return { streams }
      })

      // Create connection
      createConnection(chatId, params, 0, abortController.signal, options?.onComplete)
    },

    disconnect: (chatId) => {
      const stream = get().streams.get(chatId)
      if (stream?.eventSource) {
        stream.eventSource.close()
      }
      if (stream?.abortController) {
        stream.abortController.abort()
      }
      set((state) => {
        const streams = new Map(state.streams)
        streams.delete(chatId)
        return { streams }
      })
    },

    updateStream: (chatId, updates) => {
      set((state) => {
        const existing = state.streams.get(chatId)
        if (!existing) return state
        const streams = new Map(state.streams)
        streams.set(chatId, { ...existing, ...updates })
        return { streams }
      })
    },

    getStream: (chatId) => get().streams.get(chatId),

    isStreaming: (chatId) => get().streams.has(chatId),

    ensureStreamsFor: (chats, getAssistantMessageId) => {
      const store = get()

      // Default assistant message ID getter
      const getMessageId = getAssistantMessageId ?? ((chat) => {
        const msgs = [...chat.messages].reverse()
        return msgs.find((m) => m.role === "assistant")?.id
      })

      for (const chat of chats) {
        // Skip if no background session or no sandbox
        if (!chat.backgroundSessionId || !chat.sandboxId) continue

        // Skip if already streaming
        if (store.isStreaming(chat.id)) continue

        // Get the last assistant message ID
        const assistantMessageId = getMessageId(chat)
        if (!assistantMessageId) continue

        // Connect
        store.connect(chat.id, {
          sandboxId: chat.sandboxId,
          repoName: "project",
          backgroundSessionId: chat.backgroundSessionId,
          assistantMessageId,
          previewUrlPattern: chat.previewUrlPattern,
        })
      }
    },

    // Legacy compatibility methods (deprecated)
    startStream: (chatId, params) => {
      // This legacy method doesn't have assistantMessageId
      // It's kept for backwards compatibility during migration
      const existing = get().streams.get(chatId)
      if (existing?.eventSource) {
        existing.eventSource.close()
      }

      set((state) => {
        const streams = new Map(state.streams)
        streams.set(chatId, {
          ...createEmptyStreamState(),
          connectionParams: { ...params, assistantMessageId: "" },
        })
        return { streams }
      })
    },

    stopStream: (chatId) => {
      get().disconnect(chatId)
    },
  }
})
