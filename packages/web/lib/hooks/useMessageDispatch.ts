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
import type { Chat, Message, Settings } from "@/lib/types"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useStreamStore } from "@/lib/stores/stream-store"
import { useServerQueue } from "./useServerQueue"
import type { useStreaming } from "./useStreaming"
import type { useSuggestNameMutation } from "@/lib/query"
import { queryKeys, type SettingsData } from "@/lib/query"
import { resolveAgentAndModel } from "@/lib/types"
import {
  sendMessageToApi,
  newBranchForSend,
  applyOptimisticSend,
  removeOptimisticMessages,
  applySendSuccess,
  applySendError,
  applyRetryInPlace,
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
  /** Re-run a failed turn in place: same user/assistant message ids, no new
   *  bubbles. See useMessageDispatch's retryTurn for the full rationale. */
  retryTurn: (chatId: string) => Promise<void>
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

      // A branched chat's `messages` includes the parent's history, prepended
      // and flagged `inherited` (see /api/chats/[chatId]) so it renders in the
      // UI — but that's not a message *this* chat has sent. Only count the
      // chat's own messages so branches still get auto-named on their actual
      // first send.
      const isFirstMessage = chat.messages.every((m) => m.inherited)
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
              creditBalance: result.creditBalance,
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

  /**
   * Re-run a failed turn in place — e.g. the shared Claude credential's
   * transient OAuth hiccup (see ChatMessageList's auto-retry effect), or the
   * user clicking "Retry" on any other `status === "error"` chat.
   *
   * Deliberately NOT sendMessage(lastUserMessage.content, ...): that always
   * mints fresh message ids and appends a new optimistic user+assistant pair,
   * so a retry visibly duplicated the prompt — the failed exchange stayed in
   * history and a second, identical one appeared below it. Here the SAME
   * userMessageId/assistantMessageId are resent; persistTurn's upsert (see
   * _lib/persist-turn.ts) updates those existing rows instead of inserting
   * new ones, and bgSession.start() resumes the chat's existing CLI session
   * (same as any ordinary next message) rather than starting a fresh one. The
   * client mirrors that: applyRetryInPlace resets the existing assistant
   * bubble's content/error flags instead of adding a new one, so the user
   * just watches that one bubble go from "errored" back to "thinking…".
   */
  const retryTurn = useCallback(async (chatId: string) => {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return
    if (sendInFlight.current.has(chatId)) return
    if (stopInFlight.current.has(chatId)) return
    if (useStreamStore.getState().isStreaming(chatId)) return
    if (!session) return

    const lastUserMessage = [...chat.messages].reverse().find((m) => m.role === "user")
    const lastAssistantMessage = [...chat.messages].reverse().find((m) => m.role === "assistant")
    if (!lastUserMessage || !lastAssistantMessage) return

    const agent = lastUserMessage.agent ?? chat.agent
    const model = lastUserMessage.model ?? chat.model
    if (!agent || !model) return

    sendInFlight.current.add(chatId)

    updateChatsCache((old) => old.map((c) =>
      c.id === chatId ? applyRetryInPlace(c, lastAssistantMessage.id) : c
    ))

    try {
      const payload: SendMessagePayload = {
        message: lastUserMessage.content,
        agent,
        model,
        userMessageId: lastUserMessage.id,
        assistantMessageId: lastAssistantMessage.id,
        newBranch: newBranchForSend(chat),
      }

      const result = await sendMessageToApi(chatId, payload)

      if (!result.ok) {
        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? applySendError(c, lastAssistantMessage.id, result.error) : c
        ))
        return
      }

      const { data } = result
      updateChatsCache((old) => old.map((c) =>
        c.id === chatId ? applySendSuccess(c, data, agent, model, lastUserMessage.id) : c
      ))

      startStreaming(
        chatId,
        data.sandboxId,
        "project",
        data.backgroundSessionId,
        lastAssistantMessage.id,
        data.previewUrlPattern ?? undefined,
        data.branch
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to retry message"
      updateChatsCache((old) => old.map((c) =>
        c.id === chatId ? applySendError(c, lastAssistantMessage.id, errorMessage) : c
      ))
    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [chats, session, updateChatsCache, startStreaming])

  // Queue management is server-owned; this hook syncs it across browsers and
  // imports any prompts saved by the previous localStorage-only version.
  const { enqueueMessage, removeQueuedMessage, resumeQueue, pauseQueue } = useServerQueue({
    isHydrated,
    isAuthenticated: !!session,
    currentChat,
    reloadMessages,
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

  return { sendMessage, retryTurn, stopAgent, enqueueMessage, removeQueuedMessage, resumeQueue }
}
