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
import type { Chat, ChatStatus } from "@/lib/types"
import { getDefaultModelForAgent } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import { DEFAULT_SETTINGS } from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import {
  useChatsQuery,
  useSettingsQuery,
  useCreateChatMutation,
  useUpdateSettingsMutation,
  useSuggestNameMutation,
} from "@/lib/query"
import { useStreamStore } from "@/lib/stores/stream-store"
import { useStreaming } from "./useStreaming"
import { useChatMessageSync } from "./useChatMessageSync"
import { useChatOperations } from "./useChatOperations"
import { useMessageDispatch } from "./useMessageDispatch"
import {
  mergeLocalState,
  computeUnseenTransitions,
} from "@/lib/chat-state"

// =============================================================================
// Hook
// =============================================================================

export function useChatWithSync() {
  const { data: session, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  // TanStack Query
  const chatsQuery = useChatsQuery()
  const settingsQuery = useSettingsQuery()

  // Mutations
  const createChatMutation = useCreateChatMutation()
  const updateSettingsMutation = useUpdateSettingsMutation()
  const suggestNameMutation = useSuggestNameMutation()

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
  // While NextAuth is still resolving the session, the chats/settings queries
  // are disabled (enabled: isAuthenticated). A disabled React Query reports
  // isLoading === false with data === undefined, which would make `chats` look
  // like an empty (but loaded) list. Consumers such as the stale-chat redirect
  // would then treat a valid chat URL as "not found" and bounce it to home.
  // Treat the session-loading window as loading so we never act on empty data
  // before the queries have had a chance to run.
  const isLoading =
    sessionStatus === "loading" || chatsQuery.isLoading || settingsQuery.isLoading

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

  // Message fetching/merging (load-on-select, reload, refetch delta-sync,
  // reload-after-disconnect, client-side append) lives in its own hook.
  const { reloadMessages, refetchMessages, reloadChat, addMessageToChat } =
    useChatMessageSync({ chats, currentChatId, isHydrated, updateChatsCache })

  // Helper to check if a chat ID is a draft
  const isDraftChatId = useCallback((chatId: string | null): boolean => {
    return chatId?.startsWith("draft-") ?? false
  }, [])

  // Materialize a draft chat into a real database chat
  // Returns the full chat object so callers can use it directly without looking it up.
  // `activate: false` skips the currentChatId switch so the caller can batch it
  // with its own cache update (see sendMessage); defaults to true.
  const materializeDraft = useCallback(async (
    draftId: string,
    options?: { status?: Chat["status"]; activate?: boolean }
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
      if (options?.activate !== false) {
        useChatSyncStore.getState().completeMaterialize(draftId, newChat.id)
      }

      return newChat
    } catch (error) {
      console.error("Failed to materialize draft:", error)
      return null
    } finally {
      materializingDraft.current = false
    }
  }, [createChatMutation])

  // Chat CRUD (create/rename/repo/generic-update/delete) lives in its own hook.
  const {
    startNewChat,
    renameChat,
    updateChatRepo,
    updateChatById,
    updateCurrentChat,
    removeChat,
  } = useChatOperations({ chats, currentChatId, createChatMutation })

  const updateSettings = useCallback(async (data: { settings?: Partial<typeof settings>; credentials?: Credentials }): Promise<{ ok: boolean; error?: string }> => {
    try {
      await updateSettingsMutation.mutateAsync(data)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Failed to save settings" }
    }
  }, [updateSettingsMutation])

  // Outbound dispatch — sendMessage, stopAgent and the per-chat send queue
  // (the most coupled slice) live in their own hook.
  const { sendMessage, stopAgent, enqueueMessage, removeQueuedMessage, resumeQueue } =
    useMessageDispatch({
      currentChatId,
      currentChat,
      chats,
      isHydrated,
      session,
      settings,
      credentialFlags,
      updateChatsCache,
      startStreaming,
      suggestNameMutation,
      isDraftChatId,
      materializeDraft,
      reloadMessages,
      queryClient,
      onConflictStateChangeRef,
      queuedMessages: localChatState.queuedMessages,
      queuePaused: localChatState.queuePaused,
    })

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

  // Draft management
  const updateDraft = useCallback((chatId: string, draft: string) => {
    useChatSyncStore.getState().setDraftText(chatId, draft)
  }, [])

  const clearDraft = useCallback((chatId: string) => {
    useChatSyncStore.getState().setDraftText(chatId, undefined)
  }, [])

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
    reloadChat,
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
