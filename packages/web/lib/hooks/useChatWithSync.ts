"use client"

/**
 * useChat hook with TanStack Query
 *
 * Server data (chats, settings) managed by TanStack Query.
 * Local-only state (currentChatId, previewItems, queuedMessages) in React state + localStorage.
 * SSE streaming updates TanStack Query cache directly.
 */

import { useEffect, useCallback, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { useQueryClient } from "@tanstack/react-query"
import { nanoid } from "nanoid"
import type { Chat, ChatStatus, Message } from "@/lib/types"
import { NEW_REPOSITORY, getDefaultModelForAgent } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import {
  clearLocalStateForChats,
  collectDescendantIds,
  DEFAULT_SETTINGS,
} from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import {
  useChatsQuery,
  useSettingsQuery,
  type SettingsData,
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
import { useStreaming, mergeMessages } from "./useStreaming"
import { useQueueDispatch } from "./useQueueDispatch"
import {
  mergeLocalState,
  computeUnseenTransitions,
  removeLocalChatStateFor,
  selectFallbackNextChatId,
} from "@/lib/chat-state"
import {
  sendMessageToApi,
  resolveAgentAndModel,
  usesSharedClaudePool,
  newBranchForSend,
  applyOptimisticSend,
  removeOptimisticMessages,
  applySendSuccess,
  applySendError,
  decrementClaudeUsage,
  type SendMessagePayload,
} from "@/lib/chat-messages"

// =============================================================================
// Hook
// =============================================================================

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

  // Local-only state (owned by the chat-sync store)
  const currentChatId = useChatSyncStore((s) => s.currentChatId)
  const isHydrated = useChatSyncStore((s) => s.isHydrated)
  const unseenChatIds = useChatSyncStore((s) => s.unseenChatIds)
  const deletingChatIds = useChatSyncStore((s) => s.deletingChatIds)
  const localChatState = useChatSyncStore((s) => s.localChatState)
  const draftChatConfig = useChatSyncStore((s) => s.draftChatConfig)
  const limitReachedState = useChatSyncStore((s) => s.limitReachedState)

  // Store actions (stable references)
  const selectChat = useChatSyncStore((s) => s.selectChat)
  const updateDraftChatConfig = useChatSyncStore((s) => s.updateDraftChatConfig)
  const setLimitReachedState = useChatSyncStore((s) => s.setLimitReachedState)
  const dismissLimitReached = useChatSyncStore((s) => s.dismissLimitReached)

  // Effect-/action-local bookkeeping. These are legitimate refs (stable, never
  // rendered) used to coordinate in-flight async work; they have no
  // stale-closure hazard, so they stay as refs rather than moving to the store.
  const prevStatuses = useRef<Map<string, ChatStatus>>(new Map())
  const sendInFlight = useRef<Set<string>>(new Set())
  const stopInFlight = useRef<Set<string>>(new Set())
  const messagesLoadFailed = useRef<Set<string>>(new Set())
  const materializingDraft = useRef<boolean>(false)

  // Callback for conflict state changes from SSE complete events
  const onConflictStateChangeRef = useRef<((state: { inRebase: boolean; inMerge: boolean; conflictedFiles: string[] }) => void) | null>(null)

  // Callback for markdown file writes in plan mode - opens the file in preview
  const onMarkdownFileWriteRef = useRef<((chatId: string, filePath: string) => void) | null>(null)

  // SSE Streaming (extracted to separate hook)
  const { startStreaming, updateChatsCache } = useStreaming({
    onConflictStateChange: onConflictStateChangeRef.current,
    onMarkdownFileWrite: onMarkdownFileWriteRef.current,
  })

  // Hydration — load persisted local state into the store once on mount.
  useEffect(() => {
    useChatSyncStore.getState().hydrate()
  }, [])

  // Derived state
  const chats = useMemo(
    (): Chat[] => mergeLocalState(chatsQuery.data ?? [], localChatState),
    [chatsQuery.data, localChatState]
  )

  const settings = settingsQuery.data?.settings ?? DEFAULT_SETTINGS
  const credentialFlags = settingsQuery.data?.credentialFlags ?? {}
  const claudeLimitResetAt = settingsQuery.data?.claudeLimitResetAt ?? null
  const claudeLimitUsed = settingsQuery.data?.claudeLimitUsed ?? null
  const claudeLimitTotal = settingsQuery.data?.claudeLimitTotal ?? null
  const claudeLimitRemaining = settingsQuery.data?.claudeLimitRemaining ?? null
  const claudeIsPro = settingsQuery.data?.claudeIsPro ?? false
  const claudeIsWeekly = settingsQuery.data?.claudeIsWeekly ?? false
  const currentChat = useMemo(() => chats.find((c) => c.id === currentChatId) ?? null, [chats, currentChatId])
  const isLoading = chatsQuery.isLoading || settingsQuery.isLoading

  // Detect running → non-running transitions and badge them as unseen.
  // (Unseen persistence is handled inside the store's addUnseen/selectChat.)
  useEffect(() => {
    if (!isHydrated) return
    const { newlyUnseen, nextStatuses } = computeUnseenTransitions(
      chats,
      prevStatuses.current,
      currentChatId
    )
    prevStatuses.current = nextStatuses

    if (newlyUnseen.length > 0) {
      useChatSyncStore.getState().addUnseen(newlyUnseen)
    }
  }, [chats, currentChatId, isHydrated])

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
            return {
              ...c,
              messages: mergeMessages(c.messages, incomingMessages),
              messageCount: chatData.messageCount,
            }
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

  // Materialize a draft chat into a real database chat
  // Returns the full chat object so callers can use it directly without looking it up
  const materializeDraft = useCallback(async (
    draftId: string,
    options?: { status?: Chat["status"] }
  ): Promise<Chat | null> => {
    // Read the draft config straight from the store so we always see the current
    // value, regardless of when this callback's closure was created.
    const config = useChatSyncStore.getState().draftChatConfig
    if (!config || config.id !== draftId) {
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
        repo: config.repo,
        baseBranch: config.baseBranch,
        agent: config.agent,
        model: config.model,
        status: options?.status ?? "pending",
        planModeEnabled: config.planMode,
      })

      // Migrate local state from draft ID to real ID, clear the draft config,
      // and select the real chat (without persisting the selection — matching
      // the prior behaviour).
      useChatSyncStore.getState().completeMaterialize(draftId, newChat.id)

      return newChat
    } catch (error) {
      console.error("Failed to materialize draft:", error)
      return null
    } finally {
      materializingDraft.current = false
    }
  }, [createChatMutation])

  // Chat operations
  const startNewChat = useCallback(async (
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
    agent?: string | null,
    model?: string | null,
  ): Promise<string | null> => {
    // Branch chats (with parentChatId) are created immediately since they need to reference the parent
    if (parentChatId) {
      try {
        const newChat = await createChatMutation.mutateAsync({
          repo,
          baseBranch,
          parentChatId,
          agent,
          model,
          status: initialStatus,
        })
        if (switchTo) {
          useChatSyncStore.getState().setCurrentChatId(newChat.id)
        }
        return newChat.id
      } catch (error) {
        console.error("Failed to create chat:", error)
        return null
      }
    }

    // For regular new chats, enter draft mode instead of creating in DB
    return useChatSyncStore.getState().enterDraftMode(repo, baseBranch, agent ?? null, model ?? null)
  }, [createChatMutation])

  const removeChat = useCallback(
    async (chatId: string, getNextChatId?: (deletedIds: string[]) => string | null) => {
      const allIds = collectDescendantIds(chats, chatId)
      for (const id of allIds) useStreamStore.getState().stopStream(id)
      useChatSyncStore.getState().addDeleting(allIds)

      const selectNextChat = (deletedIds: string[]) => {
        const nextChat = getNextChatId
          ? getNextChatId(deletedIds)
          : selectFallbackNextChatId(chats, deletedIds)
        useChatSyncStore.getState().setCurrentChatId(nextChat)
      }

      // Select the next chat right away (optimistically) when the open chat is
      // being deleted, so the UI moves off it immediately instead of lingering
      // until the server round-trip completes. The sidebar already removes the
      // chat optimistically via the delete mutation's onMutate.
      if (allIds.includes(currentChatId ?? "")) {
        selectNextChat(allIds)
      }

      try {
        const result = await deleteChatMutation.mutateAsync(chatId)
        for (const sandboxId of result.sandboxIdsToCleanup) {
          sandboxDeleteMutation.mutate(sandboxId)
        }
        clearLocalStateForChats(result.deletedChatIds)
        useChatSyncStore.getState().setLocalChatState((prev) => removeLocalChatStateFor(prev, result.deletedChatIds))
        // Reconcile against the server's actual deleted set in case it removed
        // descendants we didn't predict locally and the open chat was among them.
        const serverDeletedExtra = result.deletedChatIds.some((id) => !allIds.includes(id))
        if (serverDeletedExtra && result.deletedChatIds.includes(currentChatId ?? "")) {
          selectNextChat(result.deletedChatIds)
        }
      } catch (error) {
        console.error("Failed to delete chat:", error)
      } finally {
        useChatSyncStore.getState().removeDeleting(allIds)
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
    // Can select existing repo only before first message and sandbox creation
    const canSelectExistingRepo = chat.messages.length === 0 && !chat.sandboxId
    // Can assign a new repo if chat currently has NEW_REPOSITORY
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY
    if (!canSelectExistingRepo && !canAssignNewRepo) return

    try {
      // When assigning a new repo to an existing sandbox, preserve the working branch.
      // Only reset branch to null when selecting a repo before sandbox creation.
      const branchToSet = canAssignNewRepo ? chat.branch : null
      await updateChatMutation.mutateAsync({ chatId, data: { repo, baseBranch, branch: branchToSet } })
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
    const { previewItems, activePreviewIndex, previewPaneHidden, queuedMessages, queuePaused, ...serverUpdates } = updates

    // Handle previewItems/activePreviewIndex/previewPaneHidden fields
    useChatSyncStore.getState().setPreviewStateForChat(currentChatId, { previewItems, activePreviewIndex, previewPaneHidden })

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({ chatId: currentChatId, data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"] })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [currentChatId, updateChatMutation])

  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    const { previewItems, activePreviewIndex, previewPaneHidden, ...serverUpdates } = updates

    // Handle previewItems/activePreviewIndex/previewPaneHidden fields
    useChatSyncStore.getState().setPreviewStateForChat(chatId, { previewItems, activePreviewIndex, previewPaneHidden })

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({ chatId, data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"] })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [updateChatMutation])

  // Send message
  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string, planMode?: boolean) => {
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
    if (stopInFlight.current.has(chatId)) return
    if (useStreamStore.getState().isStreaming(chatId)) return
    if (chat.status === "creating" || chat.status === "running") return

    sendInFlight.current.add(chatId)

    try {
      if (!session) return

      const isFirstMessage = chat.messages.length === 0
      const { agent: selectedAgent, model: selectedModel } = resolveAgentAndModel(
        agent,
        model,
        chat,
        settings,
        credentialFlags
      )

      const now = Date.now()
      const userMessage: Message = { id: nanoid(), role: "user", content, timestamp: now }
      const assistantMessage: Message = { id: nanoid(), role: "assistant", content: "", timestamp: now + 1, toolCalls: [], contentBlocks: [] }

      // Optimistic update
      updateChatsCache((old) => old.map((c) =>
        c.id === chatId ? applyOptimisticSend(c, userMessage, assistantMessage, now) : c
      ))

      try {
        const payload: SendMessagePayload = {
          message: content,
          agent: selectedAgent,
          model: selectedModel,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          newBranch: newBranchForSend(chat),
          planMode: planMode || undefined,
        }

        const result = await sendMessageToApi(chatId, payload, files)

        if (!result.ok) {
          // Handle daily limit exceeded error
          if (result.isDailyLimit) {
            // Remove the optimistic messages
            updateChatsCache((old) => old.map((c) =>
              c.id === chatId ? removeOptimisticMessages(c, [userMessage.id, assistantMessage.id]) : c
            ))

            // Show the limit reached dialog with pending message info
            setLimitReachedState({
              show: true,
              pendingMessage: { chatId, content, files, planMode },
              resetAt: result.resetAt ? new Date(result.resetAt) : undefined,
            })
            return
          }

          throw new Error(result.error)
        }

        const { data } = result
        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? applySendSuccess(c, data, selectedAgent, selectedModel, userMessage.id) : c
        ))

        startStreaming(chatId, data.sandboxId, "project", data.backgroundSessionId, assistantMessage.id, data.previewUrlPattern ?? undefined, data.branch, undefined, planMode)

        // Optimistically update Claude usage count if using shared pool with Claude Code
        if (usesSharedClaudePool(selectedAgent, credentialFlags)) {
          queryClient.setQueryData<SettingsData>(queryKeys.settings.all, decrementClaudeUsage)
        }

        if (isFirstMessage) {
          suggestNameMutation.mutate({ chatId, prompt: content })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? applySendError(c, assistantMessage.id, errorMessage) : c
        ))
      }
    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [currentChatId, chats, session, settings, credentialFlags, updateChatsCache, startStreaming, suggestNameMutation, isDraftChatId, materializeDraft, localChatState.previewStates, updateChatById, queryClient])

  // Predicates so useQueueDispatch can check the parent-owned in-flight refs
  // without holding them directly.
  const isSendInFlight = useCallback((chatId: string) => sendInFlight.current.has(chatId), [])
  const isStopInFlight = useCallback((chatId: string) => stopInFlight.current.has(chatId), [])

  // Queue management — owns enqueue/remove/resume/pause + the auto-drain
  // effect that dispatches the next queued message whenever a chat is idle.
  const { enqueueMessage, removeQueuedMessage, resumeQueue, pauseQueue } = useQueueDispatch({
    isHydrated,
    chats,
    currentChat,
    queuedMessages: localChatState.queuedMessages,
    queuePaused: localChatState.queuePaused,
    sendMessage,
    isSendInFlight,
    isStopInFlight,
  })

  const stopAgent = useCallback(async () => {
    if (!currentChat) return

    const chatId = currentChat.id

    // Prevent sending messages while stop is in progress
    stopInFlight.current.add(chatId)

    // Stop the SSE stream on the client side
    useStreamStore.getState().stopStream(chatId)
    const hasQueue = (currentChat.queuedMessages?.length ?? 0) > 0

    // Optimistically update the UI
    updateChatsCache((old) => old.map((c) =>
      c.id === chatId
        ? {
            ...c,
            status: "ready",
            backgroundSessionId: undefined,
            queuePaused: hasQueue ? true : c.queuePaused,
          }
        : c
    ))

    if (hasQueue) {
      pauseQueue(chatId)
    }

    // Call the stop endpoint and wait for it to complete before allowing new messages
    try {
      await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      })
    } catch (err) {
      console.error("[stopAgent] Failed to stop agent:", err)
    } finally {
      stopInFlight.current.delete(chatId)
    }
  }, [currentChat, updateChatsCache, pauseQueue])

  // Resume streaming for running chats. The key must include the last
  // assistant message id, otherwise the effect can fire once when the
  // chats query returns (with chat.messages still empty because the list
  // endpoint doesn't include messages — they load via the separate
  // loadMessages effect), find lastAssistantMsg undefined, silently
  // skip, and never re-run once messages arrive (the rest of the key
  // stays the same). Including the message id makes the key naturally
  // invalidate the moment a streamable assistant placeholder appears.
  const runningChatsKey = chats
    .filter((c) => c.status === "running" && c.backgroundSessionId && c.sandboxId)
    .map((c) => {
      // Id of the most recent assistant message, or "" if none yet.
      const lastAssistantId =
        [...c.messages].reverse().find((m) => m.role === "assistant")?.id ?? ""
      return `${c.id}:${c.backgroundSessionId}:${c.sandboxId}:${lastAssistantId}`
    })
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

  // Set up markdown file write callback for plan mode
  useEffect(() => {
    onMarkdownFileWriteRef.current = (chatId: string, filePath: string) => {
      const chatPreviewItems = localChatState.previewStates[chatId]?.items ?? []
      const filename = filePath.split("/").pop() || filePath
      // Avoid duplicates
      if (!chatPreviewItems.find((i) => i.type === "file" && i.filePath === filePath)) {
        updateChatById(chatId, {
          previewItems: [...chatPreviewItems, { type: "file", filePath, filename }],
          activePreviewIndex: chatPreviewItems.length,
          previewPaneHidden: false,
        })
      }
    }
  }, [localChatState.previewStates, updateChatById])

  // Append a message into the cached chat without going through the server.
  // Used by callers that have already produced a system message client-side.
  const addMessageToChat = useCallback((chatId: string, message: Message) => {
    updateChatsCache((old) => old.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, message] } : c))
  }, [updateChatsCache])

  // Draft management
  const updateDraft = useCallback((chatId: string, draft: string) => {
    useChatSyncStore.getState().setDraftText(chatId, draft)
  }, [])

  const clearDraft = useCallback((chatId: string) => {
    useChatSyncStore.getState().setDraftText(chatId, undefined)
  }, [])

  // Refetch messages for a specific chat (used after git operations add messages on backend)
  // Uses delta sync - only fetches messages after the last known message ID
  const refetchMessages = useCallback(async (chatId: string) => {
    try {
      // Find the last message ID for this chat to enable delta sync
      const chat = chats.find((c) => c.id === chatId)
      const lastMessageId = chat?.messages[chat.messages.length - 1]?.id

      // Fetch only new messages (after lastMessageId)
      const chatData = await fetchChat(chatId, lastMessageId ? { afterMessageId: lastMessageId } : undefined)
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

  // Set callback for conflict state changes from SSE complete events
  const setOnConflictStateChange = useCallback((
    callback: ((state: { inRebase: boolean; inMerge: boolean; conflictedFiles: string[] }) => void) | null
  ) => {
    onConflictStateChangeRef.current = callback
  }, [])

  // Retry the pending message with OpenCode agent
  const retryWithOpenCode = useCallback(() => {
    const pending = limitReachedState.pendingMessage
    if (!pending) return

    // Close the dialog first
    setLimitReachedState({ show: false })

    // Get the default model for OpenCode
    const openCodeModel = getDefaultModelForAgent("opencode", credentialFlags)

    // Send the message with OpenCode agent
    sendMessage(
      pending.content,
      "opencode",
      openCodeModel,
      pending.files,
      pending.chatId,
      pending.planMode
    )
  }, [limitReachedState.pendingMessage, credentialFlags, sendMessage])

  return {
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    claudeLimitResetAt,
    claudeLimitUsed,
    claudeLimitTotal,
    claudeLimitRemaining,
    claudeIsPro,
    claudeIsWeekly,
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
    materializeDraft,
    // Conflict state callback
    setOnConflictStateChange,
    // Daily limit reached
    limitReachedState,
    setLimitReachedState,
    dismissLimitReached,
    retryWithOpenCode,
  }
}
