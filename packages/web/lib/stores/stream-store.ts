/**
 * Stream Store - Per-chat SSE stream state management
 *
 * Holds the EventSource and reconnection state for each chat. Cumulative
 * message content is NOT stored here — the server sends a fresh snapshot
 * on every "update" frame and the client applies it directly to the
 * message in chat state. The store owns connections, not data.
 */

import { create } from "zustand"

// =============================================================================
// Types
// =============================================================================

export interface StreamState {
  /** The SSE EventSource connection */
  eventSource: EventSource | null
  /** Cursor position for reconnection */
  cursor: number
  /** Number of reconnection attempts */
  reconnectAttempts: number
  /** Connection parameters for reconnection */
  connectionParams: {
    sandboxId: string
    repoName: string
    backgroundSessionId: string
    assistantMessageId: string
    previewUrlPattern?: string
    /** Whether this stream was started in plan mode */
    planMode?: boolean
  } | null
}

interface StreamStore {
  /** Map of chatId -> stream state */
  streams: Map<string, StreamState>

  /** Initialize a new stream for a chat */
  startStream: (
    chatId: string,
    params: NonNullable<StreamState["connectionParams"]>
  ) => void

  /** Stop and clean up a stream */
  stopStream: (chatId: string) => void

  /** Update stream state */
  updateStream: (chatId: string, updates: Partial<StreamState>) => void

  /** Get stream state for a chat */
  getStream: (chatId: string) => StreamState | undefined

  /** Check if a chat is currently streaming */
  isStreaming: (chatId: string) => boolean
}

// =============================================================================
// Helpers
// =============================================================================

const createEmptyStreamState = (): StreamState => ({
  eventSource: null,
  cursor: 0,
  reconnectAttempts: 0,
  connectionParams: null,
})

// =============================================================================
// Store
// =============================================================================

export const useStreamStore = create<StreamStore>((set, get) => ({
  streams: new Map(),

  startStream: (chatId, params) => {
    // Close existing stream if any
    const existing = get().streams.get(chatId)
    if (existing?.eventSource) {
      existing.eventSource.close()
    }

    set((state) => {
      const streams = new Map(state.streams)
      streams.set(chatId, {
        ...createEmptyStreamState(),
        connectionParams: params,
      })
      return { streams }
    })
  },

  stopStream: (chatId) => {
    const stream = get().streams.get(chatId)
    if (stream?.eventSource) {
      stream.eventSource.close()
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
}))
