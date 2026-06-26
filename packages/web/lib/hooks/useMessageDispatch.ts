"use client"

/**
 * Outbound message dispatch for {@link useChatWithSync}: sending a message
 * (with draft materialization, optimistic update, pull-conflict + daily-limit
 * handling, and stream kickoff), stopping a running agent, and the per-chat
 * send queue.
 *
 * This is the most coupled slice of the chat hook, so its dependency surface is
 * passed in explicitly rather than captured implicitly — the args object is the
 * documented contract. The in-flight refs live here (used only by send/stop and
 * the queue predicates).
 */

import { useCallback, useRef, type MutableRefObject } from "react"
import { nanoid } from "nanoid"
import type { Session } from "next-auth"
import type { QueryClient } from "@tanstack/react-query"
import type { Chat, Message, QueuedMessage, Settings } from "@/lib/types"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useStreamStore } from "@/lib/stores/stream-store"
import { useQueueDispatch } from "./useQueueDispatch"
import type { useStreaming } from "./useStreaming"
import type { useSuggestNameMutation } from "@/lib/query"
import { queryKeys, type SettingsData } from "@/lib/query"
import { resolveAgentAndModel } from "@/lib/types"
import {
  sendMessageToApi,
  usesSharedClaudePool,
  newBranchForSend,
  applyOptimisticSend,
  removeOptimisticMessages,
  applySendSuccess,
  applySendError,
  decrementClaudeUsage,
  type SendMessagePayload,
} from "@/lib/chat-messages"

type StartStreaming = ReturnType<typeof useStreaming>["startStreaming"]
type SuggestNameMutation = ReturnType<typeof useSuggestNameMutation>
type ConflictStateChange = (state: {
  inRebase: boolean
  inMerge: boolean
  conflictedFiles: string[]
}) => void

interface UseMessageDispatchArgs {
  currentChatId: string | null
  currentChat: Chat | null
  chats: Chat[]
  isHydrated: boolean
  session: Session | null
  settings: Settings
  credentialFlags: SettingsData["credentialFlags"]
  updateChatsCache: (updater: (chats: Chat[]) => Chat[]) => void
  startStreaming: StartStreaming
  suggestNameMutation: SuggestNameMutation
  isDraftChatId: (chatId: string | null) => boolean
  materializeDraft: (
    draftId: string,
    options?: { status?: Chat["status"]; activate?: boolean }
  ) => Promise<Chat | null>
  reloadMessages: (chatId: string) => Promise<void>
  queryClient: QueryClient
  onConflictStateChangeRef: MutableRefObject<ConflictStateChange | null>
  queuedMessages: Record<string, QueuedMessage[] | undefined>
  queuePaused: Record<string, boolean | undefined>
}

export interface MessageDispatch {
  sendMessage: (
    content: string,
    agent?: string,
    model?: string,
    files?: File[],
    targetChatId?: string,
    planMode?: boolean
  ) => Promise<void>
  stopAgent: () => Promise<void>
  enqueueMessage: (content: string, agent?: string, model?: string) => void
  removeQueuedMessage: (id: string) => void
  resumeQueue: () => void
}

export function useMessageDispatch({
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
  queuedMessages,
  queuePaused,
}: UseMessageDispatchArgs): MessageDispatch {
  const setLimitReachedState = useChatSyncStore((s) => s.setLimitReachedState)

  // Effect-/action-local bookkeeping. Stable refs coordinating in-flight async
  // work; no stale-closure hazard, so they stay refs rather than store state.
  const sendInFlight = useRef<Set<string>>(new Set())
  const stopInFlight = useRef<Set<string>>(new Set())

  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string, planMode?: boolean) => {
    let chatId = targetChatId || currentChatId
    if (!chatId) return

    let chat: Chat | undefined

    const draftIdToActivate = isDraftChatId(chatId) ? chatId : null

    // If this is a draft chat, materialize it first. `activate: false` defers the
    // currentChatId switch until the optimistic messages are in the cache (below),
    // so the real chat isn't shown empty for one render — which flashed the "new
    // chat" welcome screen. The draft stays selected until then.
    if (draftIdToActivate) {
      const materializedChat = await materializeDraft(chatId, { activate: false })
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
        agent ?? chat.agent,
        model ?? chat.model,
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

      // Switch to the real chat in the same synchronous block as the optimistic
      // update above, so both commit in one render (no empty-chat flash).
      if (draftIdToActivate) {
        useChatSyncStore.getState().completeMaterialize(draftIdToActivate, chatId)
      }

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
          // Pre-run auto-pull hit a merge conflict and left the merge in
          // progress. Roll back the optimistic messages, restore the typed text
          // to the composer, and surface the *existing* merge-conflict UI (header
          // indicator + Abort Merge) — same as a merge/rebase conflict. The user
          // then re-sends to have the agent resolve it, or aborts the merge.
          if ("isPullConflict" in result) {
            updateChatsCache((old) => old.map((c) =>
              c.id === chatId ? removeOptimisticMessages(c, [userMessage.id, assistantMessage.id]) : c
            ))
            // Keep the user's message available to send again.
            useChatSyncStore.getState().setDraftText(chatId, content)
            // Show the git-operation message the server appended.
            await reloadMessages(chatId)
            // Light up the conflict indicator immediately (the in-progress merge
            // is also detected by check-rebase-status on the next status poll).
            onConflictStateChangeRef.current?.({
              inRebase: false,
              inMerge: true,
              conflictedFiles: result.conflictedFiles,
            })
            return
          }

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
              provider: result.provider,
              used: result.used,
              limit: result.limit,
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
  }, [currentChatId, chats, session, settings, credentialFlags, updateChatsCache, startStreaming, suggestNameMutation, isDraftChatId, materializeDraft, queryClient, reloadMessages, setLimitReachedState, onConflictStateChangeRef])

  // Predicates so useQueueDispatch can check the in-flight refs without holding
  // them directly.
  const isSendInFlight = useCallback((chatId: string) => sendInFlight.current.has(chatId), [])
  const isStopInFlight = useCallback((chatId: string) => stopInFlight.current.has(chatId), [])

  // Queue management — owns enqueue/remove/resume/pause + the auto-drain
  // effect that dispatches the next queued message whenever a chat is idle.
  const { enqueueMessage, removeQueuedMessage, resumeQueue, pauseQueue } = useQueueDispatch({
    isHydrated,
    chats,
    currentChat,
    queuedMessages,
    queuePaused,
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

  return { sendMessage, stopAgent, enqueueMessage, removeQueuedMessage, resumeQueue }
}
