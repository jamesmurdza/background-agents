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
import type { AppState, Chat, ChatStatus, Message, QueuedMessage, Settings, SSEUpdateEvent, SSECompleteEvent } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { generateBranchName } from "@/lib/utils"
import {
  // Local state (device-specific)
  loadLocalState,
  setCurrentChatId,
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
  toSettingsType,
} from "@/lib/sync/api"
import { useStreamStore } from "@/lib/stores/stream-store"

// SSE reconnection settings
const SSE_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_ATTEMPTS = 10

// Default empty state for SSR
const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  anthropicAuthToken: "",
  openaiApiKey: "",
  opencodeApiKey: "",
  geminiApiKey: "",
  defaultAgent: "opencode",
  defaultModel: "opencode/big-pickle",
  theme: "system",
}

const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: DEFAULT_SETTINGS,
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

  // =============================================================================
  // Initial Load - Fetch from server
  // =============================================================================

  useEffect(() => {
    // Load local state immediately (device-specific)
    const localState = loadLocalState()
    setUnseenChatIds(loadUnseenChatIds())

    // Load cached server data for immediate display
    const cache = loadServerCache()
    const chatsWithLocalState = cache.chats.map((chat) => ({
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
        }
      }
      return {
        currentChatId: localState.currentChatId,
        chats: chatsWithLocalState,
        settings: cache.settings,
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
        const settings = toSettingsType(
          serverSettings.settings,
          serverSettings.credentialFlags
        )

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

        // Update state with ID-based merging
        // Local state with more content wins over server state
        setState((prev) => ({
          ...prev,
          chats: mergeChats(prev.chats, incomingWithLocal),
          settings,
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

    // Load messages if not already loaded
    const chat = state.chats.find((c) => c.id === chatId)
    if (chat && chat.messages.length === 0) {
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
                ? { ...c, messages: mergeMessages(existingChat.messages, incomingMessages) }
                : c
            ),
          }
        })
      } catch (err) {
        console.error("Failed to load chat messages:", err)
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
      await apiUpdateChat(chatId, { repo, baseBranch } as unknown as Parameters<typeof apiUpdateChat>[1])

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

  const updateSettings = useCallback(async (settings: Partial<Settings>) => {
    try {
      // Separate settings from credentials
      const { anthropicApiKey, anthropicAuthToken, openaiApiKey, opencodeApiKey, geminiApiKey, ...otherSettings } = settings

      const credentials: Record<string, string> = {}
      if (anthropicApiKey !== undefined) credentials.anthropicApiKey = anthropicApiKey
      if (anthropicAuthToken !== undefined) credentials.anthropicAuthToken = anthropicAuthToken
      if (openaiApiKey !== undefined) credentials.openaiApiKey = openaiApiKey
      if (opencodeApiKey !== undefined) credentials.opencodeApiKey = opencodeApiKey
      if (geminiApiKey !== undefined) credentials.geminiApiKey = geminiApiKey

      const response = await apiUpdateSettings({
        settings: Object.keys(otherSettings).length > 0 ? otherSettings : undefined,
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      })

      const newSettings = toSettingsType(response.settings, response.credentialFlags)

      // Update cache
      updateCacheSettings(newSettings)

      // Update state
      setState((prev) => ({
        ...prev,
        settings: newSettings,
      }))
    } catch (error) {
      console.error("Failed to update settings:", error)
    }
  }, [])

  const updateCurrentChat = useCallback(async (updates: Partial<Chat>) => {
    if (!state.currentChatId) return

    try {
      await apiUpdateChat(state.currentChatId, updates as unknown as Parameters<typeof apiUpdateChat>[1])

      // Update cache
      updateCacheChat(state.currentChatId, updates)

      // Update state
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === state.currentChatId ? { ...c, ...updates } : c
        ),
      }))
    } catch (error) {
      console.error("Failed to update chat:", error)
    }
  }, [state.currentChatId])

  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    try {
      await apiUpdateChat(chatId, updates as unknown as Parameters<typeof apiUpdateChat>[1])

      // Update cache
      updateCacheChat(chatId, updates)

      // Update state
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, ...updates } : c
        ),
      }))
    } catch (error) {
      console.error("Failed to update chat:", error)
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

          store.appendContent(chatId, data.content)
          store.appendToolCalls(chatId, data.toolCalls)
          store.appendContentBlocks(chatId, data.contentBlocks)

          const accumulated = store.getAccumulated(chatId)
          if (accumulated) {
            // Update local state
            setState((prev) => ({
              ...prev,
              chats: prev.chats.map((c) => {
                if (c.id !== chatId) return c
                const messages = [...c.messages]
                const lastIndex = messages.length - 1
                if (lastIndex >= 0) {
                  messages[lastIndex] = {
                    ...messages[lastIndex],
                    content: accumulated.content,
                    toolCalls: accumulated.toolCalls,
                    contentBlocks: accumulated.contentBlocks,
                  }
                }
                return { ...c, messages, lastActiveAt: Date.now() }
              }),
            }))

            // Update cache
            updateCacheLastMessage(chatId, {
              content: accumulated.content,
              toolCalls: accumulated.toolCalls,
              contentBlocks: accumulated.contentBlocks,
            })
          }
        } catch (err) {
          console.error("Failed to parse SSE update:", err)
        }
      })

      eventSource.addEventListener("complete", async (event) => {
        // Ignore events if aborted
        if (abortSignal?.aborted) return

        try {
          const data: SSECompleteEvent = JSON.parse(event.data)

          // Get accumulated content BEFORE stopping the stream
          // stopStream() deletes the stream state including accumulated content
          const store = useStreamStore.getState()
          const accumulated = store.getAccumulated(chatId)

          // Stop the stream
          store.stopStream(chatId)

          const updates: Partial<Chat> = {
            status: data.status === "error" ? "error" : "ready",
            backgroundSessionId: undefined,
            lastActiveAt: Date.now(),
          }
          if (data.sessionId) {
            updates.sessionId = data.sessionId
          }

          // Update state with final message content
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) => {
              if (c.id !== chatId) return c
              // Update chat status AND preserve final message content
              const messages = [...c.messages]
              if (messages.length > 0 && accumulated) {
                const lastIndex = messages.length - 1
                messages[lastIndex] = {
                  ...messages[lastIndex],
                  content: accumulated.content,
                  toolCalls: accumulated.toolCalls,
                  contentBlocks: accumulated.contentBlocks,
                }
              }
              return { ...c, ...updates, messages }
            }),
          }))

          // Update cache with final message content
          updateCacheChat(chatId, updates)
          if (accumulated) {
            updateCacheLastMessage(chatId, {
              content: accumulated.content,
              toolCalls: accumulated.toolCalls,
              contentBlocks: accumulated.contentBlocks,
            })
          }

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

          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId
                ? { ...c, status: "error" as const, backgroundSessionId: undefined }
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

    // Guard: prevent concurrent sends
    if (useStreamStore.getState().isStreaming(chatId)) {
      console.warn("Already streaming for this chat")
      return
    }

    const isNewRepo = chat.repo === NEW_REPOSITORY
    if (!isNewRepo && !session?.accessToken) return

    const isFirstMessage = chat.messages.length === 0
    const selectedAgent = agent || chat.agent || state.settings.defaultAgent
    const selectedModel = model || chat.model || state.settings.defaultModel

    // 1. Add user message IMMEDIATELY (synchronous)
    const userMessage: Message = {
      id: nanoid(),
      role: "user",
      content,
      timestamp: Date.now(),
    }

    setState((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, userMessage],
              lastActiveAt: Date.now(),
              queuePaused: false,
            }
          : c
      ),
    }))

    // Add to cache so it persists
    updateCacheMessages(chatId, [userMessage])

    // 2. Create sandbox if needed
    let sandboxId = chat.sandboxId
    let branch = chat.branch
    let previewUrlPattern = chat.previewUrlPattern

    if (!sandboxId) {
      branch = `agent/${generateBranchName()}`

      // Update status to creating
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, status: "creating" as const, branch } : c
        ),
      }))

      try {
        const response = await fetch("/api/sandbox/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: chat.repo,
            baseBranch: chat.baseBranch || "main",
            newBranch: branch,
            chatId, // Pass chatId so server can create DB records
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to create sandbox")
        }

        const data = await response.json()
        sandboxId = data.sandboxId
        previewUrlPattern = data.previewUrlPattern

        setState((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chatId
              ? { ...c, sandboxId, branch, previewUrlPattern, status: "ready" as const }
              : c
          ),
        }))
      } catch (error) {
        console.error("Failed to create sandbox:", error)
        const errorMessage: Message = {
          id: nanoid(),
          role: "assistant",
          content: `Failed to create sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
          timestamp: Date.now(),
          isError: true,
        }
        setState((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, errorMessage], status: "error" as const }
              : c
          ),
        }))
        return
      }
    }

    // 3. Upload files if any
    let uploadedFilePaths: string[] | undefined
    if (files && files.length > 0 && sandboxId) {
      try {
        const formData = new FormData()
        formData.append("sandboxId", sandboxId)
        formData.append("repoPath", "/home/daytona/project")
        files.forEach((file, index) => formData.append(`file-${index}`, file))

        const uploadResponse = await fetch("/api/sandbox/upload", {
          method: "POST",
          body: formData,
        })

        if (uploadResponse.ok) {
          const result = await uploadResponse.json()
          uploadedFilePaths = result.uploadedFiles.map((f: { path: string }) => f.path)

          // Update user message with uploaded files
          setState((prev) => ({
            ...prev,
            chats: prev.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === userMessage.id ? { ...m, uploadedFiles: uploadedFilePaths } : m
                    ),
                  }
                : c
            ),
          }))
        }
      } catch (error) {
        console.error("Failed to upload files:", error)
        // Continue without files
      }
    }

    // 4. Add assistant placeholder and start agent
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
          ? { ...c, messages: [...c.messages, assistantMessage], status: "running" as const }
          : c
      ),
    }))

    // Add to cache so streaming updates work
    updateCacheMessages(chatId, [assistantMessage])

    // 5. Start agent
    try {
      // Build prompt with uploaded files if any
      let agentPrompt = content
      if (uploadedFilePaths && uploadedFilePaths.length > 0) {
        agentPrompt += "\n\n---\nUploaded files:\n" + uploadedFilePaths.map((p) => `- ${p}`).join("\n")
      }

      const response = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoName: "project",
          prompt: agentPrompt,
          agent: selectedAgent,
          model: selectedModel,
          sessionId: chat.sessionId,
          previewUrlPattern,
          chatId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to start agent")
      }

      const data = await response.json()

      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? { ...c, backgroundSessionId: data.backgroundSessionId }
            : c
        ),
      }))

      // Start SSE streaming
      startStreaming(
        chatId,
        sandboxId!,
        "project",
        data.backgroundSessionId,
        assistantMessage.id,
        previewUrlPattern
      )

      // Generate chat name for first message
      if (isFirstMessage) {
        fetch("/api/chat/suggest-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: content }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.name) {
              apiUpdateChat(chatId, { displayName: data.name }).catch(() => {})
              updateCacheChat(chatId, { displayName: data.name })
              setState((prev) => ({
                ...prev,
                chats: prev.chats.map((c) =>
                  c.id === chatId ? { ...c, displayName: data.name } : c
                ),
              }))
            }
          })
          .catch((err) => console.error("Failed to generate name:", err))
      }
    } catch (error) {
      console.error("Failed to start agent:", error)
      setState((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                status: "error" as const,
                messages: c.messages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`, isError: true }
                    : m
                ),
              }
            : c
        ),
      }))
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

  // Recovery: resume streaming for running chats
  useEffect(() => {
    if (!isHydrated) return

    const abortController = new AbortController()

    const runningChats = state.chats.filter(
      (c) => c.backgroundSessionId && c.sandboxId
    )

    for (const chat of runningChats) {
      if (useStreamStore.getState().isStreaming(chat.id)) continue

      // Find the last assistant message ID
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

    // Cleanup: abort streams when effect re-runs (React StrictMode)
    return () => {
      abortController.abort()
    }
  }, [isHydrated, state.chats, startStreaming])

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
