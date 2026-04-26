"use client"

/**
 * useChat hook with server sync
 *
 * This is the server-first version of the useChat hook.
 * All mutations go through the server first, then update local cache.
 * localStorage acts as a read-only cache.
 *
 * Key differences from the original useChat:
 * 1. Initial load fetches from server, not localStorage
 * 2. All chat/message mutations go through server API
 * 3. Credentials are stored server-side (encrypted)
 * 4. Device-specific state (currentChatId, unseenChatIds) stays local
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { nanoid } from "nanoid"
import type { AppState, Chat, ChatStatus, Message, QueuedMessage, Settings, SSEUpdateEvent, SSECompleteEvent, Agent } from "@/lib/types"
import { NEW_REPOSITORY, getDefaultAgent, getDefaultModelForAgent } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import { generateBranchName } from "@/lib/utils"
import {
  // Local state (device-specific)
  loadLocalState,
  setCurrentChatId,
  setPreviewItem,
  loadUnseenChatIds,
  saveUnseenChatIds,
  setQueuedMessages,
  setQueuePaused,
  // Server cache
  loadServerCache,
  updateCacheChats,
  updateCacheChat,
  addCacheChat,
  removeCacheChats,
  updateCacheMessages,
  updateCacheLastMessage,
  updateCacheSettings,
  updateCacheCredentialFlags,
  DEFAULT_SETTINGS,
  // Merge utilities
  mergeChats,
  mergeMessages,
  // Legacy
  collectDescendantIds,
} from "@/lib/storage"
import {
  fetchChats,
  fetchChat,
  createChat as apiCreateChat,
  updateChat as apiUpdateChat,
  deleteChat as apiDeleteChat,
  fetchSettings,
  updateSettings as apiUpdateSettings,
  toChatType,
  toMessageType,
} from "@/lib/sync/api"
import { useStreamStore } from "@/lib/stores/stream-store"

// SSE reconnection settings
const SSE_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_ATTEMPTS = 10

const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: DEFAULT_SETTINGS,
  credentialFlags: {},
}

export function useChatWithSync() {
  const { data: session, status: sessionStatus } = useSession()

  // Start with empty state to avoid hydration mismatch
  const [state, setState] = useState<AppState>(DEFAULT_STATE)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [unseenChatIds, setUnseenChatIds] = useState<Set<string>>(new Set())
  const [deletingChatIds, setDeletingChatIds] = useState<Set<string>>(new Set())
  const prevStatuses = useRef<Map<string, ChatStatus>>(new Map())
  // Synchronous guard for sendMessage re-entry. The isStreaming check
  // doesn't help during stages (b)–(c) (sandbox create / file upload)
  // because the stream hasn't started yet; a double-click in that window
  // would otherwise create two sandboxes and race them.
  const sendInFlight = useRef<Set<string>>(new Set())

  // =============================================================================
  // Initial Load - Fetch from server
  // =============================================================================

  useEffect(() => {
    // Load local state immediately (device-specific)
    const localState = loadLocalState()
    setUnseenChatIds(loadUnseenChatIds())

    // Load cached server data for immediate display.
    // Filter out any "local-*" IDs left over from the previous unauth
    // fallback — those chats can never sync to the server and just
    // accumulate as orphans.
    const cache = loadServerCache()
    const chatsWithLocalState = cache.chats
      .filter((chat) => !chat.id.startsWith("local-"))
      .map((chat) => ({
        ...chat,
        previewItem: localState.previewItems[chat.id],
        queuedMessages: localState.queuedMessages[chat.id],
        queuePaused: localState.queuePaused[chat.id],
      }))

    // IMPORTANT: Use mergeChats to preserve any in-flight streaming content
    // This prevents cache loads from wiping out active streaming state
    setState((prev) => {
      if (prev.chats.length > 0) {
        return {
          currentChatId: localState.currentChatId,
          chats: mergeChats(prev.chats, chatsWithLocalState),
          settings: cache.settings,
          credentialFlags: cache.credentialFlags,
        }
      }
      return {
        currentChatId: localState.currentChatId,
        chats: chatsWithLocalState,
        settings: cache.settings,
        credentialFlags: cache.credentialFlags,
      }
    })
    setIsHydrated(true)

    // If not authenticated, we're done
    if (sessionStatus === "loading") return
    if (sessionStatus === "unauthenticated" || !session?.user?.id) {
      setIsLoading(false)
      return
    }

    // Fetch fresh data from server
    const loadFromServer = async () => {
      try {
        const [serverChats, serverSettings] = await Promise.all([
          fetchChats(),
          fetchSettings(),
        ])

        // Convert to client types
        const incomingChats = serverChats.map(toChatType)
        const settings = serverSettings.settings
        const credentialFlags = serverSettings.credentialFlags

        // Merge with local state using ID-based merging
        // This ensures streaming content (with more data) wins over stale server data
        const incomingWithLocal = incomingChats.map((chat) => ({
          ...chat,
          previewItem: localState.previewItems[chat.id],
          queuedMessages: localState.queuedMessages[chat.id],
          queuePaused: localState.queuePaused[chat.id],
        }))

        // Update cache
        updateCacheChats(incomingChats)
        updateCacheSettings(settings)
        updateCacheCredentialFlags(credentialFlags)

        // Update state with ID-based merging
        // Local state with more content wins over server state
        setState((prev) => ({
          ...prev,
          chats: mergeChats(prev.chats, incomingWithLocal),
          settings,
          credentialFlags,
        }))

        // Load messages for current chat using merge
        if (localState.currentChatId) {
          const chatExists = incomingChats.some((c) => c.id === localState.currentChatId)
          if (chatExists) {
            try {
              const chatData = await fetchChat(localState.currentChatId)
              const incomingMessages = chatData.messages.map(toMessageType)

              // Merge messages - local streaming content wins if it has more data
              setState((prev) => ({
                ...prev,
                chats: prev.chats.map((c) => {
                  if (c.id !== localState.currentChatId) return c
                  return { ...c, messages: mergeMessages(c.messages, incomingMessages) }
                }),
              }))
            } catch (err) {
              console.error("Failed to load current chat messages:", err)
            }
          }
        }
      } catch (error) {
        console.error("Failed to load from server:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadFromServer()
  }, [session?.user?.id, sessionStatus])

  // =============================================================================
  // Persist unseen set (device-specific)
  // =============================================================================

  useEffect(() => {
    if (isHydrated) {
      saveUnseenChatIds(unseenChatIds)
    }
  }, [unseenChatIds, isHydrated])

  // Detect running → non-running transitions and mark unseen
  useEffect(() => {
    if (!isHydrated) return

    const currentIds = new Set<string>()
    const newlyUnseen: string[] = []
    for (const chat of state.chats) {
      currentIds.add(chat.id)
      const prevStatus = prevStatuses.current.get(chat.id)
      if (
        prevStatus === "running" &&
        chat.status !== "running" &&
        chat.id !== state.currentChatId
      ) {
        newlyUnseen.push(chat.id)
      }
      prevStatuses.current.set(chat.id, chat.status)
    }
    for (const id of Array.from(prevStatuses.current.keys())) {
      if (!currentIds.has(id)) prevStatuses.current.delete(id)
    }

    setUnseenChatIds((prev) => {
      let next = prev
      for (const id of newlyUnseen) {
        if (!prev.has(id)) {
          if (next === prev) next = new Set(prev)
          next.add(id)
        }
      }
      for (const id of prev) {
        if (!currentIds.has(id)) {
          if (next === prev) next = new Set(prev)
          next.delete(id)
        }
      }
      return next
    })
  }, [state.chats, state.currentChatId, isHydrated])

  // Get current chat
  const currentChat = state.chats.find((c) => c.id === state.currentChatId) ?? null

  // =============================================================================
  // Chat Operations (Server-First)
  // =============================================================================

  const startNewChat = useCallback(async (
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
  ): Promise<string | null> => {
    try {
      // Create on server first
      const serverChat = await apiCreateChat({
        repo,
        baseBranch,
        parentChatId,
        status: initialStatus,
      })

      const chat = toChatType(serverChat)

      // Update cache
      addCacheChat(chat)

      // Update state
      setState((prev) => ({
        ...prev,
        chats: [chat, ...prev.chats],
        currentChatId: switchTo ? chat.id : prev.currentChatId,
      }))

      // Update local state
      if (switchTo) {
        setCurrentChatId(chat.id)
      }

      return chat.id
    } catch (error) {
      // Auth failures (and any other error) bubble up as null. The UI
      // gates "new chat" affordances behind a sign-in prompt for
      // unauthenticated users; this hook does not create local-only
      // fallback chats.
      console.error("Failed to create chat:", error)
      return null
    }
  }, [])

  const selectChat = useCallback(async (chatId: string) => {
    // Mark as seen
    setUnseenChatIds((prev) => {
      if (!prev.has(chatId)) return prev
      const next = new Set(prev)
      next.delete(chatId)
      return next
    })

    // Update local state
    setCurrentChatId(chatId)

    // Update React state
    setState((prev) => ({
      ...prev,
      currentChatId: chatId,
    }))

    // Load messages if not already loaded. Skip if a previous load failed
    // — without this guard, every click on a chat whose fetch errors would
    // re-trigger another doomed fetch.
    const chat = state.chats.find((c) => c.id === chatId)
    if (chat && chat.messages.length === 0 && !chat.messagesLoadFailed) {
      try {
        const chatData = await fetchChat(chatId)
        const incomingMessages = chatData.messages.map(toMessageType)

        // Use ID-based merging - local content wins if it has more data
        setState((prev) => {
          const existingChat = prev.chats.find((c) => c.id === chatId)
          if (!existingChat) return prev

          return {
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: mergeMessages(existingChat.messages, incomingMessages),
                    messagesLoadFailed: false,
                  }
                : c
            ),
          }
        })
      } catch (err) {
        console.error("Failed to load chat messages:", err)
        setState((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chatId ? { ...c, messagesLoadFailed: true } : c
          ),
        }))
      }
    }
  }, [state.chats])

  const removeChat = useCallback(async (chatId: string) => {
    // Collect descendants locally first for UI
    const allIds = collectDescendantIds(state.chats, chatId)

    // Stop SSE streams and mark as deleting
    for (const id of allIds) useStreamStore.getState().stopStream(id)
    setDeletingChatIds((prev) => new Set([...prev, ...allIds]))

    try {
      // Delete on server
      const result = await apiDeleteChat(chatId)

      // Clean up sandboxes
      for (const sandboxId of result.sandboxIdsToCleanup) {
        fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId }),
        }).catch((err) => console.error("Failed to delete sandbox:", err))
      }

      // Update cache
      removeCacheChats(result.deletedChatIds)

      // Update state
      setState((prev) => {
        const deletedSet = new Set(result.deletedChatIds)
        const newChats = prev.chats.filter((c) => !deletedSet.has(c.id))
        return {
          ...prev,
          chats: newChats,
          currentChatId:
            prev.currentChatId && deletedSet.has(prev.currentChatId)
              ? newChats[0]?.id ?? null
              : prev.currentChatId,
        }
      })
    } catch (error) {
      console.error("Failed to delete chat:", error)
    } finally {
      setDeletingChatIds((prev) => {
        const next = new Set(prev)
        for (const id of allIds) next.delete(id)
        return next
      })
    }
  }, [state.chats])

  const renameChat = useCallback(async (chatId: string, newName: string) => {
    try {
      await apiUpdateChat(chatId, { displayName: newName })

      // Update cache
      updateCacheChat(chatId, { displayName: newName })

      // Update state
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, displayName: newName } : c
        ),
      }))
    } catch (error) {
      console.error("Failed to rename chat:", error)
    }
  }, [])

  const updateChatRepo = useCallback(async (chatId: string, repo: string, baseBranch: string) => {
    const chat = state.chats.find((c) => c.id === chatId)
    if (!chat) return

    const canSelectRepo = chat.messages.length === 0 && !chat.sandboxId
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY

    if (!canSelectRepo && !canAssignNewRepo) return

    try {
      await apiUpdateChat(chatId, { repo, baseBranch })

      // Update local state
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, repo, baseBranch } : c
        ),
      }))
    } catch (error) {
      console.error("Failed to update chat repo:", error)
    }
  }, [state.chats])

  // =============================================================================
  // Settings (Server-First)
  // =============================================================================

  const updateSettings = useCallback(async (data: {
    settings?: Partial<Settings>
    credentials?: Credentials
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await apiUpdateSettings(data)

      updateCacheSettings(response.settings)
      updateCacheCredentialFlags(response.credentialFlags)

      setState((prev) => ({
        ...prev,
        settings: response.settings,
        credentialFlags: response.credentialFlags,
      }))

      return { ok: true }
    } catch (error) {
      console.error("Failed to update settings:", error)
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save settings",
      }
    }
  }, [])

  const updateCurrentChat = useCallback(async (updates: Partial<Chat>) => {
    if (!state.currentChatId) return

    // Separate local-only fields from server-synced fields
    // Local-only: previewItem, queuedMessages, queuePaused (stored in localStorage, not sent to server)
    const { previewItem, queuedMessages, queuePaused, ...serverUpdates } = updates

    // Handle local-only updates (previewItem)
    if (previewItem !== undefined) {
      setPreviewItem(state.currentChatId, previewItem)
    }

    // Update React state for all fields (local + server)
    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === state.currentChatId ? { ...c, ...updates } : c
      ),
    }))

    // Only call the server API if there are server-synced fields to update
    if (Object.keys(serverUpdates).length > 0) {
      try {
        await apiUpdateChat(state.currentChatId, serverUpdates as unknown as Parameters<typeof apiUpdateChat>[1])

        // Update cache (only for server-synced fields)
        updateCacheChat(state.currentChatId, serverUpdates)
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [state.currentChatId])

  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    // Separate local-only fields from server-synced fields
    // Local-only: previewItem, queuedMessages, queuePaused (stored in localStorage, not sent to server)
    const { previewItem, queuedMessages, queuePaused, ...serverUpdates } = updates

    // Handle local-only updates (previewItem)
    if (previewItem !== undefined) {
      setPreviewItem(chatId, previewItem)
    }

    // Update React state for all fields (local + server)
    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === chatId ? { ...c, ...updates } : c
      ),
    }))

    // Only call the server API if there are server-synced fields to update
    if (Object.keys(serverUpdates).length > 0) {
      try {
        await apiUpdateChat(chatId, serverUpdates as unknown as Parameters<typeof apiUpdateChat>[1])

        // Update cache (only for server-synced fields)
        updateCacheChat(chatId, serverUpdates)
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [])

  // =============================================================================
  // SSE Streaming
  // =============================================================================

  const startStreaming = useCallback((
    chatId: string,
    sandboxId: string,
    repoName: string,
    backgroundSessionId: string,
    assistantMessageId: string,
    previewUrlPattern?: string,
    abortSignal?: AbortSignal
  ) => {
    const streamStore = useStreamStore.getState()

    if (streamStore.isStreaming(chatId)) {
      streamStore.stopStream(chatId)
    }

    streamStore.startStream(chatId, {
      sandboxId,
      repoName,
      backgroundSessionId,
      previewUrlPattern,
    })

    const connect = (cursor: number = 0) => {
      // Check if aborted before connecting
      if (abortSignal?.aborted) {
        streamStore.stopStream(chatId)
        return
      }

      const currentStore = useStreamStore.getState()
      const streamState = currentStore.getStream(chatId)
      if (!streamState) return

      const params = new URLSearchParams({
        sandboxId,
        repoName,
        backgroundSessionId,
        chatId,
        assistantMessageId,
      })
      if (previewUrlPattern) params.set("previewUrlPattern", previewUrlPattern)
      if (cursor > 0) params.set("cursor", cursor.toString())

      const eventSource = new EventSource(`/api/agent/stream?${params}`)
      currentStore.updateStream(chatId, { eventSource })

      // Close EventSource when abort signal fires
      abortSignal?.addEventListener("abort", () => {
        eventSource.close()
        useStreamStore.getState().stopStream(chatId)
      })

      eventSource.addEventListener("update", (event) => {
        // Ignore events if aborted
        if (abortSignal?.aborted) return

        try {
          const data: SSEUpdateEvent = JSON.parse(event.data)
          const store = useStreamStore.getState()
          if (!store.isStreaming(chatId)) return

          store.updateStream(chatId, {
            cursor: data.cursor,
            reconnectAttempts: 0,
          })

          // The server sends a cumulative snapshot in every update frame.
          // Apply it directly to the assistant message — do NOT append to
          // a per-chat accumulator (that produces O(n²) duplication).
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) => {
              if (c.id !== chatId) return c
              const messages = [...c.messages]
              const lastIndex = messages.length - 1
              if (lastIndex >= 0) {
                messages[lastIndex] = {
                  ...messages[lastIndex],
                  content: data.content,
                  toolCalls: data.toolCalls,
                  contentBlocks: data.contentBlocks,
                }
              }
              return { ...c, messages, lastActiveAt: Date.now() }
            }),
          }))

          updateCacheLastMessage(chatId, {
            content: data.content,
            toolCalls: data.toolCalls,
            contentBlocks: data.contentBlocks,
          })
        } catch (err) {
          console.error("Failed to parse SSE update:", err)
        }
      })

      eventSource.addEventListener("complete", async (event) => {
        // Ignore events if aborted
        if (abortSignal?.aborted) return

        try {
          const data: SSECompleteEvent = JSON.parse(event.data)

          useStreamStore.getState().stopStream(chatId)

          const updates: Partial<Chat> = {
            status: data.status === "error" ? "error" : "ready",
            backgroundSessionId: undefined,
            lastActiveAt: Date.now(),
            errorMessage: data.status === "error" ? (data.error || "Agent failed without an error message") : undefined,
          }
          if (data.sessionId) {
            updates.sessionId = data.sessionId
          }

          // The final message content was delivered in the last "update"
          // frame; we only need to transition chat status here.
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId ? { ...c, ...updates } : c
            ),
          }))

          updateCacheChat(chatId, updates)

          // Auto-push for GitHub repos
          if (data.status === "completed") {
            setState((prev) => {
              const chat = prev.chats.find((c) => c.id === chatId)
              if (chat?.branch && chat.repo !== NEW_REPOSITORY) {
                fetch("/api/git/push", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sandboxId,
                    repoName,
                    branch: chat.branch,
                  }),
                }).catch((err) => console.error("Auto-push failed:", err))
              }
              return prev
            })
          }
        } catch (err) {
          console.error("Failed to parse SSE complete:", err)
        }
      })

      eventSource.addEventListener("heartbeat", (event) => {
        // Ignore events if aborted
        if (abortSignal?.aborted) return

        try {
          const data = JSON.parse(event.data)
          const store = useStreamStore.getState()
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

      eventSource.addEventListener("error", (event) => {
        // Ignore events if aborted
        if (abortSignal?.aborted) return

        try {
          const data = JSON.parse((event as MessageEvent).data)
          console.error("SSE error:", data.error)
          useStreamStore.getState().stopStream(chatId)

          const errorMessage = data.error || "Agent stream failed without an error message"
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId
                ? { ...c, status: "error" as const, backgroundSessionId: undefined, errorMessage }
                : c
            ),
          }))
        } catch {
          // Connection error - handled by onerror
        }
      })

      eventSource.onerror = () => {
        // Don't reconnect if aborted
        if (abortSignal?.aborted) return

        eventSource.close()
        const store = useStreamStore.getState()
        const stream = store.getStream(chatId)
        if (!stream) return

        const attempts = (stream.reconnectAttempts || 0) + 1
        if (attempts <= SSE_MAX_RECONNECT_ATTEMPTS) {
          store.updateStream(chatId, {
            reconnectAttempts: attempts,
            eventSource: null,
          })
          setTimeout(() => {
            if (useStreamStore.getState().isStreaming(chatId)) {
              connect(stream.cursor)
            }
          }, SSE_RECONNECT_DELAY)
        } else {
          store.stopStream(chatId)
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId && c.status === "running"
                ? { ...c, status: "ready" as const }
                : c
            ),
          }))
        }
      }
    }

    connect()
  }, [])

  // =============================================================================
  // Messaging (Optimistic Updates)
  // =============================================================================

  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string) => {
    // For targetChatId, read from state directly since React state may not have updated yet
    const chatId = targetChatId || state.currentChatId
    if (!chatId) return

    const chat = state.chats.find((c) => c.id === chatId)
    if (!chat) return

    // Concurrency guards — three layers, narrowest first:
    //   1. Synchronous in-flight ref: catches a re-entrant call within
    //      the same tick (double-click before any state update lands).
    //   2. Streaming check: catches the case where stage (d) already
    //      started a stream.
    //   3. Status check: catches state-visible mid-pipeline state.
    if (sendInFlight.current.has(chatId)) {
      console.warn("Send already in flight for this chat")
      return
    }
    if (useStreamStore.getState().isStreaming(chatId)) {
      console.warn("Already streaming for this chat")
      return
    }
    if (chat.status === "creating" || chat.status === "running") {
      console.warn(`Chat is ${chat.status}; can't send`)
      return
    }
    sendInFlight.current.add(chatId)
    try {

    // Sending always requires a session. The UI shows a sign-in prompt
    // before reaching this point; this is a defensive backstop.
    if (!session?.accessToken) return

    const isFirstMessage = chat.messages.length === 0
    const selectedAgent = (agent ?? chat.agent ?? state.settings.defaultAgent ?? getDefaultAgent(state.credentialFlags)) as Agent
    const selectedModel = model ?? chat.model ?? state.settings.defaultModel ?? getDefaultModelForAgent(selectedAgent, state.credentialFlags)

    // Optimistic UI: add user + assistant messages immediately.
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

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, userMessage, assistantMessage],
              status: chat.sandboxId ? ("running" as const) : ("creating" as const),
              lastActiveAt: Date.now(),
              queuePaused: false,
              errorMessage: undefined,
            }
          : c
      ),
    }))
    updateCacheMessages(chatId, [userMessage, assistantMessage])

    try {
      // One server round-trip: orchestrate sandbox-create + file-upload +
      // message-persist + agent-start atomically. If anything fails the
      // server cleans up (deletes a just-created sandbox, marks chat as
      // error) before responding.
      const payload = {
        message: content,
        agent: selectedAgent,
        model: selectedModel,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        newBranch: chat.sandboxId ? undefined : `agent/${generateBranchName()}`,
      }

      let response: Response
      if (files && files.length > 0) {
        const formData = new FormData()
        formData.append("payload", JSON.stringify(payload))
        files.forEach((file, i) => formData.append(`file-${i}`, file))
        response = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          body: formData,
        })
      } else {
        response = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to send message")
      }

      const data = (await response.json()) as {
        sandboxId: string
        branch: string | null
        previewUrlPattern: string | null
        backgroundSessionId: string
        uploadedFiles: string[]
      }

      // Reflect server-assigned sandbox + agent/model + uploadedFiles back
      // into local state.
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id !== chatId
            ? c
            : {
                ...c,
                sandboxId: data.sandboxId,
                branch: data.branch,
                previewUrlPattern: data.previewUrlPattern ?? undefined,
                backgroundSessionId: data.backgroundSessionId,
                agent: selectedAgent,
                model: selectedModel,
                status: "running" as const,
                messages: c.messages.map((m) =>
                  m.id === userMessage.id && data.uploadedFiles.length > 0
                    ? { ...m, uploadedFiles: data.uploadedFiles }
                    : m
                ),
              }
        ),
      }))

      // Start SSE streaming with the server-confirmed identifiers.
      startStreaming(
        chatId,
        data.sandboxId,
        "project",
        data.backgroundSessionId,
        assistantMessage.id,
        data.previewUrlPattern ?? undefined
      )

      // Generate chat name for first message (fire-and-forget).
      if (isFirstMessage) {
        fetch("/api/chat/suggest-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: content }),
        })
          .then((res) => res.json())
          .then((nameData) => {
            if (nameData.name) {
              apiUpdateChat(chatId, { displayName: nameData.name }).catch(() => {})
              updateCacheChat(chatId, { displayName: nameData.name })
              setState((prev) => ({
                ...prev,
                chats: prev.chats.map((c) =>
                  c.id === chatId ? { ...c, displayName: nameData.name } : c
                ),
              }))
            }
          })
          .catch((err) => console.error("Failed to generate name:", err))
      }
    } catch (error) {
      console.error("Failed to send message:", error)
      // Server already cleaned up its side (sandbox + chat row) on failure.
      // Mark the assistant placeholder as the visible error and roll back
      // chat status.
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                status: "error" as const,
                errorMessage,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? {
                        ...m,
                        content: `Error: ${errorMessage}`,
                        isError: true,
                      }
                    : m
                ),
              }
            : c
        ),
      }))
    }

    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [state.currentChatId, state.chats, state.settings, session?.accessToken, startStreaming])

  const stopAgent = useCallback(() => {
    if (!currentChat) return

    useStreamStore.getState().stopStream(currentChat.id)
    const hasQueue = (currentChat.queuedMessages?.length ?? 0) > 0

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === currentChat.id
          ? {
              ...c,
              status: "ready" as const,
              queuePaused: hasQueue ? true : c.queuePaused,
            }
          : c
      ),
    }))

    if (hasQueue) {
      setQueuePaused(currentChat.id, true)
    }
  }, [currentChat])

  // Recovery: resume streaming for running chats.
  //
  // Depend on a stable signature of which chats need streaming, NOT on
  // state.chats itself. state.chats's reference changes on every snapshot
  // frame during a streaming response; if the effect depended on it
  // directly, the cleanup would abort and reconnect the EventSource on
  // every frame.
  const runningChatsKey = state.chats
    .filter((c) => c.backgroundSessionId && c.sandboxId)
    .map((c) => `${c.id}:${c.backgroundSessionId}:${c.sandboxId}`)
    .sort()
    .join("|")

  useEffect(() => {
    if (!isHydrated) return

    const abortController = new AbortController()

    const runningChats = state.chats.filter(
      (c) => c.backgroundSessionId && c.sandboxId
    )

    for (const chat of runningChats) {
      if (useStreamStore.getState().isStreaming(chat.id)) continue

      const lastAssistantMsg = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant")

      if (lastAssistantMsg) {
        startStreaming(
          chat.id,
          chat.sandboxId!,
          "project",
          chat.backgroundSessionId!,
          lastAssistantMsg.id,
          chat.previewUrlPattern,
          abortController.signal
        )
      }
    }

    return () => {
      abortController.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, runningChatsKey, startStreaming])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const store = useStreamStore.getState()
      for (const chatId of store.streams.keys()) {
        store.stopStream(chatId)
      }
    }
  }, [])

  // =============================================================================
  // Queue Management (Local)
  // =============================================================================

  const addMessageToChat = useCallback((chatId: string, message: Message) => {
    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, message] }
          : c
      ),
    }))
  }, [])

  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChat) return

    const queued: QueuedMessage = {
      id: `q-${Date.now()}`,
      content,
      agent,
      model,
    }
    const existing = currentChat.queuedMessages ?? []
    const newQueue = [...existing, queued]

    setQueuedMessages(currentChat.id, newQueue)
    setQueuePaused(currentChat.id, false)

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === currentChat.id
          ? { ...c, queuedMessages: newQueue, queuePaused: false }
          : c
      ),
    }))
  }, [currentChat])

  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return

    const existing = currentChat.queuedMessages ?? []
    const newQueue = existing.filter((m) => m.id !== id)

    setQueuedMessages(currentChat.id, newQueue)

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === currentChat.id
          ? { ...c, queuedMessages: newQueue }
          : c
      ),
    }))
  }, [currentChat])

  const resumeQueue = useCallback(() => {
    if (!currentChat || !currentChat.queuePaused) return

    setQueuePaused(currentChat.id, false)

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === currentChat.id ? { ...c, queuePaused: false } : c
      ),
    }))
  }, [currentChat])

  return {
    // State
    chats: state.chats,
    currentChat,
    currentChatId: state.currentChatId,
    settings: state.settings,
    credentialFlags: state.credentialFlags,
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
    addMessage: addMessageToChat,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
  }
}
