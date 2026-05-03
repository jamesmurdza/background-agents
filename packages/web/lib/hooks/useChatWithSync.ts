"use client"

/**
 * useChat hook with TanStack Query
 *
 * Server data (chats, settings) managed by TanStack Query.
 * Local-only state (currentChatId, previewItems, queuedMessages) in React state + localStorage.
 * SSE streaming updates TanStack Query cache directly.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { useQueryClient } from "@tanstack/react-query"
import { nanoid } from "nanoid"
import type { Chat, ChatStatus, Message, QueuedMessage, SSEUpdateEvent, SSECompleteEvent, Agent } from "@/lib/types"
import { NEW_REPOSITORY, getDefaultAgent, getDefaultModelForAgent } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import { generateBranchName } from "@/lib/utils"
import {
  loadLocalState,
  setCurrentChatId as persistCurrentChatId,
  setPreviewState,
  loadUnseenChatIds,
  saveUnseenChatIds,
  setQueuedMessages,
  setQueuePaused,
  setDraft,
  clearLocalStateForChats,
  collectDescendantIds,
  DEFAULT_SETTINGS,
  setDraftChatConfig,
  clearDraftChatConfig,
  migrateDraftToRealChat,
  type DraftChatConfig,
  type PreviewState,
} from "@/lib/storage"
import {
  useChatsQuery,
  useSettingsQuery,
  useCreateChatMutation,
  useUpdateChatMutation,
  useDeleteChatMutation,
  useUpdateSettingsMutation,
  useSuggestNameMutation,
  useSandboxDeleteMutation,
  queryKeys,
} from "@/lib/query"
import { useStreamStore } from "@/lib/stores/stream-store"
import { fetchChat, toMessageType } from "@/lib/sync/api"

const SSE_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_ATTEMPTS = 10

/**
 * Merge messages, preferring the one with more content.
 * This handles the case where streaming has accumulated content
 * but server has stale/empty content.
 */
function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
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

export function useChatWithSync() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  // TanStack Query
  const chatsQuery = useChatsQuery()
  const settingsQuery = useSettingsQuery()

  // Mutations
  const createChatMutation = useCreateChatMutation()
  const updateChatMutation = useUpdateChatMutation()
  const deleteChatMutation = useDeleteChatMutation()
  const updateSettingsMutation = useUpdateSettingsMutation()
  const suggestNameMutation = useSuggestNameMutation()
  const sandboxDeleteMutation = useSandboxDeleteMutation()

  // Local-only state
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [unseenChatIds, setUnseenChatIds] = useState<Set<string>>(new Set())
  const [deletingChatIds, setDeletingChatIds] = useState<Set<string>>(new Set())
  const [localChatState, setLocalChatState] = useState<{
    previewStates: Record<string, PreviewState>
    queuedMessages: Record<string, Chat["queuedMessages"]>
    queuePaused: Record<string, boolean>
    drafts: Record<string, string>
  }>({ previewStates: {}, queuedMessages: {}, queuePaused: {}, drafts: {} })
  const [draftChatConfig, setDraftChatConfigState] = useState<DraftChatConfig | undefined>(undefined)

  const prevStatuses = useRef<Map<string, ChatStatus>>(new Map())
  const sendInFlight = useRef<Set<string>>(new Set())
  const queueDispatchInFlight = useRef<Set<string>>(new Set())
  const messagesLoadFailed = useRef<Set<string>>(new Set())
  const materializingDraft = useRef<boolean>(false)

  // Hydration
  useEffect(() => {
    const localState = loadLocalState()
    setCurrentChatIdState(localState.currentChatId)
    setUnseenChatIds(loadUnseenChatIds())
    setLocalChatState({
      previewStates: localState.previewStates,
      queuedMessages: localState.queuedMessages,
      queuePaused: localState.queuePaused,
      drafts: localState.drafts,
    })
    setDraftChatConfigState(localState.draftChatConfig)
    setIsHydrated(true)
  }, [])

  // Derived state
  const chats = useMemo((): Chat[] => {
    const serverChats = chatsQuery.data ?? []
    return serverChats.map((chat) => {
      const previewState = localChatState.previewStates[chat.id]
      return {
        ...chat,
        previewItems: previewState?.items,
        activePreviewIndex: previewState?.activeIndex,
        queuedMessages: localChatState.queuedMessages[chat.id],
        queuePaused: localChatState.queuePaused[chat.id],
      }
    })
  }, [chatsQuery.data, localChatState])

  const settings = settingsQuery.data?.settings ?? DEFAULT_SETTINGS
  const credentialFlags = settingsQuery.data?.credentialFlags ?? {}
  const currentChat = useMemo(() => chats.find((c) => c.id === currentChatId) ?? null, [chats, currentChatId])
  const isLoading = chatsQuery.isLoading || settingsQuery.isLoading

  // Persist unseen
  useEffect(() => {
    if (isHydrated) saveUnseenChatIds(unseenChatIds)
  }, [unseenChatIds, isHydrated])

  // Detect running → non-running transitions
  useEffect(() => {
    if (!isHydrated) return
    const currentIds = new Set<string>()
    const newlyUnseen: string[] = []

    for (const chat of chats) {
      currentIds.add(chat.id)
      const prevStatus = prevStatuses.current.get(chat.id)
      if (prevStatus === "running" && chat.status !== "running" && chat.id !== currentChatId) {
        newlyUnseen.push(chat.id)
      }
      prevStatuses.current.set(chat.id, chat.status)
    }

    for (const id of Array.from(prevStatuses.current.keys())) {
      if (!currentIds.has(id)) prevStatuses.current.delete(id)
    }

    if (newlyUnseen.length > 0) {
      setUnseenChatIds((prev) => {
        const next = new Set(prev)
        newlyUnseen.forEach((id) => next.add(id))
        return next
      })
    }
  }, [chats, currentChatId, isHydrated])

  // Helper to update query cache
  const updateChatsCache = useCallback((updater: (chats: Chat[]) => Chat[]) => {
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old) => {
      if (!old) return old
      return updater(old)
    })
  }, [queryClient])

  // Load messages for current chat when selected
  useEffect(() => {
    if (!currentChatId || !isHydrated) return

    const chat = chats.find((c) => c.id === currentChatId)
    if (!chat) return

    // Skip if messages already loaded or previous load failed
    if (chat.messages.length > 0 || messagesLoadFailed.current.has(currentChatId)) {
      return
    }

    const loadMessages = async () => {
      try {
        const chatData = await fetchChat(currentChatId)
        const incomingMessages = chatData.messages.map(toMessageType)

        updateChatsCache((old) =>
          old.map((c) => {
            if (c.id !== currentChatId) return c
            return { ...c, messages: mergeMessages(c.messages, incomingMessages) }
          })
        )
      } catch (err) {
        console.error("Failed to load chat messages:", err)
        messagesLoadFailed.current.add(currentChatId)
      }
    }

    loadMessages()
  }, [currentChatId, chats, isHydrated, updateChatsCache])

  // Helper to check if a chat ID is a draft
  const isDraftChatId = useCallback((chatId: string | null): boolean => {
    return chatId?.startsWith("draft-") ?? false
  }, [])

  // Enter draft mode - creates a local-only chat that isn't persisted to the database
  const enterDraftMode = useCallback((
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    agent: string | null = null,
    model: string | null = null,
  ): string => {
    const draftId = `draft-${nanoid()}`
    const config: DraftChatConfig = { id: draftId, repo, baseBranch, agent, model }
    setDraftChatConfigState(config)
    setDraftChatConfig(config)
    setCurrentChatIdState(draftId)
    persistCurrentChatId(draftId)
    return draftId
  }, [])

  // Update the draft chat config (both React state and localStorage)
  const updateDraftChatConfig = useCallback((updates: Partial<Omit<DraftChatConfig, "id">>) => {
    if (!draftChatConfig) return
    const newConfig: DraftChatConfig = { ...draftChatConfig, ...updates }
    setDraftChatConfigState(newConfig)
    setDraftChatConfig(newConfig)
  }, [draftChatConfig])

  // Materialize a draft chat into a real database chat
  // Returns the full chat object so callers can use it directly without looking it up
  const materializeDraft = useCallback(async (
    draftId: string,
    options?: { status?: Chat["status"] }
  ): Promise<Chat | null> => {
    if (!draftChatConfig || draftChatConfig.id !== draftId) {
      console.error("Cannot materialize: draft config not found for", draftId)
      return null
    }

    if (materializingDraft.current) {
      // Already materializing, wait for it
      return null
    }

    materializingDraft.current = true
    try {
      const newChat = await createChatMutation.mutateAsync({
        repo: draftChatConfig.repo,
        baseBranch: draftChatConfig.baseBranch,
        status: options?.status ?? "pending",
      })

      // Migrate local state from draft ID to real ID
      migrateDraftToRealChat(draftId, newChat.id)
      setLocalChatState((prev) => {
        const newPreviewStates = { ...prev.previewStates }
        const newQueuedMessages = { ...prev.queuedMessages }
        const newQueuePaused = { ...prev.queuePaused }
        const newDrafts = { ...prev.drafts }

        if (newPreviewStates[draftId]) {
          newPreviewStates[newChat.id] = newPreviewStates[draftId]
          delete newPreviewStates[draftId]
        }
        if (newQueuedMessages[draftId]) {
          newQueuedMessages[newChat.id] = newQueuedMessages[draftId]
          delete newQueuedMessages[draftId]
        }
        if (newQueuePaused[draftId] !== undefined) {
          newQueuePaused[newChat.id] = newQueuePaused[draftId]
          delete newQueuePaused[draftId]
        }
        if (newDrafts[draftId]) {
          newDrafts[newChat.id] = newDrafts[draftId]
          delete newDrafts[draftId]
        }

        return { previewStates: newPreviewStates, queuedMessages: newQueuedMessages, queuePaused: newQueuePaused, drafts: newDrafts }
      })

      // Clear draft config and update current chat ID
      setDraftChatConfigState(undefined)
      clearDraftChatConfig()
      setCurrentChatIdState(newChat.id)

      return newChat
    } catch (error) {
      console.error("Failed to materialize draft:", error)
      return null
    } finally {
      materializingDraft.current = false
    }
  }, [draftChatConfig, createChatMutation])

  // Chat operations
  const startNewChat = useCallback(async (
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
  ): Promise<string | null> => {
    // Branch chats (with parentChatId) are created immediately since they need to reference the parent
    if (parentChatId) {
      try {
        const newChat = await createChatMutation.mutateAsync({ repo, baseBranch, parentChatId, status: initialStatus })
        if (switchTo) {
          setCurrentChatIdState(newChat.id)
          persistCurrentChatId(newChat.id)
        }
        return newChat.id
      } catch (error) {
        console.error("Failed to create chat:", error)
        return null
      }
    }

    // For regular new chats, enter draft mode instead of creating in DB
    const draftId = enterDraftMode(repo, baseBranch)
    return draftId
  }, [createChatMutation, enterDraftMode])

  const selectChat = useCallback((chatId: string) => {
    setUnseenChatIds((prev) => {
      if (!prev.has(chatId)) return prev
      const next = new Set(prev)
      next.delete(chatId)
      return next
    })
    setCurrentChatIdState(chatId)
    persistCurrentChatId(chatId)
  }, [])

  const removeChat = useCallback(
    async (chatId: string, getNextChatId?: (deletedIds: string[]) => string | null) => {
      const allIds = collectDescendantIds(chats, chatId)
      for (const id of allIds) useStreamStore.getState().stopStream(id)
      setDeletingChatIds((prev) => new Set([...prev, ...allIds]))

      try {
        const result = await deleteChatMutation.mutateAsync(chatId)
        for (const sandboxId of result.sandboxIdsToCleanup) {
          sandboxDeleteMutation.mutate(sandboxId)
        }
        clearLocalStateForChats(result.deletedChatIds)
        setLocalChatState((prev) => {
          const next = { ...prev, previewStates: { ...prev.previewStates }, queuedMessages: { ...prev.queuedMessages }, queuePaused: { ...prev.queuePaused }, drafts: { ...prev.drafts } }
          for (const id of result.deletedChatIds) {
            delete next.previewStates[id]
            delete next.queuedMessages[id]
            delete next.queuePaused[id]
            delete next.drafts[id]
          }
          return next
        })
        if (result.deletedChatIds.includes(currentChatId ?? "")) {
          let nextChat: string | null = null
          if (getNextChatId) {
            nextChat = getNextChatId(result.deletedChatIds)
          } else {
            // Fallback: select first remaining chat
            const remaining = chats.filter((c) => !result.deletedChatIds.includes(c.id))
            nextChat = remaining[0]?.id ?? null
          }
          setCurrentChatIdState(nextChat)
          persistCurrentChatId(nextChat)
        }
      } catch (error) {
        console.error("Failed to delete chat:", error)
      } finally {
        setDeletingChatIds((prev) => {
          const next = new Set(prev)
          for (const id of allIds) next.delete(id)
          return next
        })
      }
    },
    [chats, currentChatId, deleteChatMutation, sandboxDeleteMutation]
  )

  const renameChat = useCallback(async (chatId: string, newName: string) => {
    try {
      await updateChatMutation.mutateAsync({ chatId, data: { displayName: newName } })
    } catch (error) {
      console.error("Failed to rename chat:", error)
    }
  }, [updateChatMutation])

  const updateChatRepo = useCallback(async (chatId: string, repo: string, baseBranch: string) => {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return
    const canSelectRepo = chat.messages.length === 0 && !chat.sandboxId
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY
    if (!canSelectRepo && !canAssignNewRepo) return

    try {
      // Reset branch to null when changing repo (branch is created on first message)
      await updateChatMutation.mutateAsync({ chatId, data: { repo, baseBranch, branch: null } })
    } catch (error) {
      console.error("Failed to update chat repo:", error)
    }
  }, [chats, updateChatMutation])

  const updateSettings = useCallback(async (data: { settings?: Partial<typeof settings>; credentials?: Credentials }): Promise<{ ok: boolean; error?: string }> => {
    try {
      await updateSettingsMutation.mutateAsync(data)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Failed to save settings" }
    }
  }, [updateSettingsMutation])

  const updateCurrentChat = useCallback(async (updates: Partial<Chat>) => {
    if (!currentChatId) return
    const { previewItems, activePreviewIndex, queuedMessages, queuePaused, ...serverUpdates } = updates

    // Handle previewItems/activePreviewIndex fields
    if ("previewItems" in updates || "activePreviewIndex" in updates) {
      const currentState = localChatState.previewStates[currentChatId]
      const newState: PreviewState | undefined = previewItems === undefined && activePreviewIndex === undefined
        ? undefined
        : {
            items: previewItems ?? currentState?.items ?? [],
            activeIndex: activePreviewIndex ?? currentState?.activeIndex ?? 0,
          }
      setPreviewState(currentChatId, newState)
      setLocalChatState((prev) => {
        const newPreviewStates = { ...prev.previewStates }
        if (newState === undefined) {
          delete newPreviewStates[currentChatId]
        } else {
          newPreviewStates[currentChatId] = newState
        }
        return { ...prev, previewStates: newPreviewStates }
      })
    }

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({ chatId: currentChatId, data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"] })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [currentChatId, localChatState.previewStates, updateChatMutation])

  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    const { previewItems, activePreviewIndex, ...serverUpdates } = updates

    // Handle previewItems/activePreviewIndex fields
    if ("previewItems" in updates || "activePreviewIndex" in updates) {
      const currentState = localChatState.previewStates[chatId]
      const newState: PreviewState | undefined = previewItems === undefined && activePreviewIndex === undefined
        ? undefined
        : {
            items: previewItems ?? currentState?.items ?? [],
            activeIndex: activePreviewIndex ?? currentState?.activeIndex ?? 0,
          }
      setPreviewState(chatId, newState)
      setLocalChatState((prev) => {
        const newPreviewStates = { ...prev.previewStates }
        if (newState === undefined) {
          delete newPreviewStates[chatId]
        } else {
          newPreviewStates[chatId] = newState
        }
        return { ...prev, previewStates: newPreviewStates }
      })
    }

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({ chatId, data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"] })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [localChatState.previewStates, updateChatMutation])

  // SSE Streaming
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

          // Auto-push is now handled by the backend in the stream route
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

          // Fetch any new messages created by the backend (e.g., push failure messages)
          // This uses delta sync - only fetches messages after the assistant message
          try {
            const chatData = await fetchChat(chatId, assistantMessageId)
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

  // Send message
  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string) => {
    let chatId = targetChatId || currentChatId
    if (!chatId) return

    let chat: Chat | undefined

    // If this is a draft chat, materialize it first
    if (isDraftChatId(chatId)) {
      const materializedChat = await materializeDraft(chatId)
      if (!materializedChat) {
        console.error("Failed to materialize draft chat before sending message")
        return
      }
      chatId = materializedChat.id
      chat = materializedChat
    } else {
      chat = chats.find((c) => c.id === chatId)
      // Fallback to query cache if not found in chats array (e.g., newly created branched chat
      // where React state hasn't re-rendered yet but the cache has been updated)
      if (!chat) {
        const cachedChats = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())
        chat = cachedChats?.find((c) => c.id === chatId)
      }
    }

    if (!chat) return

    if (sendInFlight.current.has(chatId)) return
    if (useStreamStore.getState().isStreaming(chatId)) return
    if (chat.status === "creating" || chat.status === "running") return

    sendInFlight.current.add(chatId)

    try {
      if (!session?.accessToken) return

      const isFirstMessage = chat.messages.length === 0
      const selectedAgent = (agent ?? chat.agent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
      const selectedModel = model ?? chat.model ?? settings.defaultModel ?? getDefaultModelForAgent(selectedAgent, credentialFlags)

      const userMessage: Message = { id: nanoid(), role: "user", content, timestamp: Date.now() }
      const assistantMessage: Message = { id: nanoid(), role: "assistant", content: "", timestamp: Date.now() + 1, toolCalls: [], contentBlocks: [] }

      // Optimistic update
      updateChatsCache((old) => old.map((c) =>
        c.id === chatId ? {
          ...c,
          messages: [...c.messages, userMessage, assistantMessage],
          status: chat.sandboxId ? "running" : "creating",
          lastActiveAt: Date.now(),
          errorMessage: undefined,
        } : c
      ))

      try {
        const payload = {
          message: content,
          agent: selectedAgent,
          model: selectedModel,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          newBranch: chat.sandboxId ? undefined : `agent/${generateBranchName()}`,
        }

        let response: Response
        if (files?.length) {
          const formData = new FormData()
          formData.append("payload", JSON.stringify(payload))
          files.forEach((file, i) => formData.append(`file-${i}`, file))
          response = await fetch(`/api/chats/${chatId}/messages`, { method: "POST", body: formData })
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

        const data = await response.json() as {
          sandboxId: string
          branch: string | null
          previewUrlPattern: string | null
          backgroundSessionId: string
          uploadedFiles: string[]
        }

        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? {
            ...c,
            sandboxId: data.sandboxId,
            branch: data.branch,
            previewUrlPattern: data.previewUrlPattern ?? undefined,
            backgroundSessionId: data.backgroundSessionId,
            agent: selectedAgent,
            model: selectedModel,
            status: "running",
            messages: c.messages.map((m) =>
              m.id === userMessage.id && data.uploadedFiles.length > 0 ? { ...m, uploadedFiles: data.uploadedFiles } : m
            ),
          } : c
        ))

        startStreaming(chatId, data.sandboxId, "project", data.backgroundSessionId, assistantMessage.id, data.previewUrlPattern ?? undefined, data.branch)

        if (isFirstMessage) {
          suggestNameMutation.mutate({ chatId, prompt: content })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? {
            ...c,
            status: "error",
            errorMessage,
            messages: c.messages.map((m) =>
              m.id === assistantMessage.id ? { ...m, content: `Error: ${errorMessage}`, isError: true } : m
            ),
          } : c
        ))
      }
    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [currentChatId, chats, session?.accessToken, settings, credentialFlags, updateChatsCache, startStreaming, suggestNameMutation, isDraftChatId, materializeDraft])

  const dispatchNextQueuedMessage = useCallback((chatId: string, queueOverride?: QueuedMessage[]) => {
    const chat = chats.find((c) => c.id === chatId)
    const queue = queueOverride ?? localChatState.queuedMessages[chatId]
    if (!chat || !queue || queue.length === 0) return false
    if (localChatState.queuePaused[chatId]) return false
    if (queueDispatchInFlight.current.has(chatId)) return false
    if (sendInFlight.current.has(chatId)) return false
    if (useStreamStore.getState().isStreaming(chatId)) return false
    if (chat.status !== "ready" || !!chat.backgroundSessionId) return false

    const [first, ...rest] = queue
    queueDispatchInFlight.current.add(chatId)
    setQueuedMessages(chatId, rest.length > 0 ? rest : undefined)
    setLocalChatState((prev) => ({
      ...prev,
      queuedMessages: { ...prev.queuedMessages, [chatId]: rest.length > 0 ? rest : undefined },
    }))

    void sendMessage(first.content, first.agent, first.model, undefined, chatId)
      .finally(() => {
        queueDispatchInFlight.current.delete(chatId)
      })

    return true
  }, [chats, localChatState.queuedMessages, localChatState.queuePaused, sendMessage])

  const stopAgent = useCallback(async () => {
    if (!currentChat) return

    // Stop the SSE stream on the client side
    useStreamStore.getState().stopStream(currentChat.id)
    const hasQueue = (currentChat.queuedMessages?.length ?? 0) > 0

    // Optimistically update the UI
    updateChatsCache((old) => old.map((c) =>
      c.id === currentChat.id
        ? {
            ...c,
            status: "ready",
            backgroundSessionId: undefined,
            queuePaused: hasQueue ? true : c.queuePaused,
          }
        : c
    ))

    if (hasQueue) {
      setQueuePaused(currentChat.id, true)
      setLocalChatState((prev) => ({ ...prev, queuePaused: { ...prev.queuePaused, [currentChat.id]: true } }))
    }

    // Call the stop endpoint to actually kill the agent process
    // This is fire-and-forget - we've already updated the UI optimistically
    try {
      await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: currentChat.id }),
      })
    } catch (err) {
      console.error("[stopAgent] Failed to stop agent:", err)
    }
  }, [currentChat, updateChatsCache])

  // Resume streaming for running chats
  const runningChatsKey = chats
    .filter((c) => c.status === "running" && c.backgroundSessionId && c.sandboxId)
    .map((c) => `${c.id}:${c.backgroundSessionId}:${c.sandboxId}`)
    .sort()
    .join("|")

  useEffect(() => {
    if (!isHydrated) return
    const abortController = new AbortController()
    const runningChats = chats.filter((c) => c.status === "running" && c.backgroundSessionId && c.sandboxId)

    for (const chat of runningChats) {
      if (useStreamStore.getState().isStreaming(chat.id)) continue
      const lastAssistantMsg = [...chat.messages].reverse().find((m) => m.role === "assistant")
      if (lastAssistantMsg) {
        startStreaming(chat.id, chat.sandboxId!, "project", chat.backgroundSessionId!, lastAssistantMsg.id, chat.previewUrlPattern, chat.branch, abortController.signal)
      }
    }

    return () => abortController.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, runningChatsKey, startStreaming])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const store = useStreamStore.getState()
      for (const chatId of store.streams.keys()) store.stopStream(chatId)
    }
  }, [])

  // Queue management
  const addMessageToChat = useCallback((chatId: string, message: Message) => {
    updateChatsCache((old) => old.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, message] } : c))
  }, [updateChatsCache])

  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChat) return
    const queued: QueuedMessage = { id: `q-${Date.now()}`, content, agent, model }
    const newQueue = [...(currentChat.queuedMessages ?? []), queued]

    setQueuedMessages(currentChat.id, newQueue)
    setQueuePaused(currentChat.id, false)
    setLocalChatState((prev) => ({
      ...prev,
      queuedMessages: { ...prev.queuedMessages, [currentChat.id]: newQueue },
      queuePaused: { ...prev.queuePaused, [currentChat.id]: false },
    }))
  }, [currentChat])

  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return
    const newQueue = (currentChat.queuedMessages ?? []).filter((m) => m.id !== id)
    setQueuedMessages(currentChat.id, newQueue)
    setLocalChatState((prev) => ({ ...prev, queuedMessages: { ...prev.queuedMessages, [currentChat.id]: newQueue } }))
  }, [currentChat])

  const resumeQueue = useCallback(() => {
    if (!currentChat?.queuePaused) return
    setQueuePaused(currentChat.id, false)
    setLocalChatState((prev) => ({ ...prev, queuePaused: { ...prev.queuePaused, [currentChat.id]: false } }))
  }, [currentChat])

  // Draft management
  const updateDraft = useCallback((chatId: string, draft: string) => {
    setDraft(chatId, draft)
    setLocalChatState((prev) => {
      const newDrafts = { ...prev.drafts }
      if (draft === "") {
        delete newDrafts[chatId]
      } else {
        newDrafts[chatId] = draft
      }
      return { ...prev, drafts: newDrafts }
    })
  }, [])

  const clearDraft = useCallback((chatId: string) => {
    setDraft(chatId, undefined)
    setLocalChatState((prev) => {
      const newDrafts = { ...prev.drafts }
      delete newDrafts[chatId]
      return { ...prev, drafts: newDrafts }
    })
  }, [])

  // Drain any ready, unpaused queue. The queue is client-owned, so if the
  // browser sees a ready chat with queued prompts, it should continue dispatching.
  useEffect(() => {
    if (!isHydrated) return

    for (const chat of chats) {
      const queue = localChatState.queuedMessages[chat.id]
      const paused = localChatState.queuePaused[chat.id]
      if (!queue || queue.length === 0 || paused) continue
      dispatchNextQueuedMessage(chat.id, queue)
    }
  }, [chats, dispatchNextQueuedMessage, isHydrated, localChatState.queuedMessages, localChatState.queuePaused])

  // Refetch messages for a specific chat (used after git operations add messages on backend)
  // Uses delta sync - only fetches messages after the last known message ID
  const refetchMessages = useCallback(async (chatId: string) => {
    try {
      // Find the last message ID for this chat to enable delta sync
      const chat = chats.find((c) => c.id === chatId)
      const lastMessageId = chat?.messages[chat.messages.length - 1]?.id

      // Fetch only new messages (after lastMessageId)
      const chatData = await fetchChat(chatId, lastMessageId)
      const incomingMessages = chatData.messages.map(toMessageType)

      if (incomingMessages.length > 0) {
        updateChatsCache((old) =>
          old.map((c) => {
            if (c.id !== chatId) return c
            return { ...c, messages: mergeMessages(c.messages, incomingMessages) }
          })
        )
      }
    } catch (err) {
      console.error("Failed to refetch messages:", err)
    }
  }, [chats, updateChatsCache])

  // True when messages need to be loaded for current chat (to prevent flash of empty state)
  // A chat needs loading if: has no messages locally, but server says it has messages (messageCount > 0)
  const isLoadingMessages = currentChat
    ? currentChat.messages.length === 0 && (currentChat.messageCount ?? 0) > 0
    : false

  return {
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    isHydrated,
    isLoading,
    isLoadingMessages,
    deletingChatIds,
    unseenChatIds,
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
    refetchMessages,
    drafts: localChatState.drafts,
    updateDraft,
    clearDraft,
    // Draft chat support
    draftChatConfig,
    isDraftChatId,
    updateDraftChatConfig,
  }
}
