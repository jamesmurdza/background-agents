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
import { useToastStore } from "@/lib/stores/toast-store"
import { useServerQueue } from "./useServerQueue"
import type { useStreaming } from "./useStreaming"
import type { useSuggestNameMutation } from "@/lib/query"
import { queryKeys, type SettingsData } from "@/lib/query"
import { resolveAgentAndModel } from "@/lib/types"
import { fetchChat } from "@/lib/sync/api"
import { applyRecoveredChat } from "@/lib/chat-recovery"
import { applyPendingMcpServers, applyPendingEnvVars } from "@/lib/sandbox-client"
import {
  sendMessageToApi,
  newBranchForSend,
  applyOptimisticSend,
  removeOptimisticMessages,
  applySendSuccess,
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
    planMode?: boolean,
    reasoningEffort?: string
  ) => Promise<void>
  stopAgent: () => Promise<void>
  enqueueMessage: (content: string, agent?: string, model?: string, reasoningEffort?: string) => void
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

  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string, planMode?: boolean, reasoningEffort?: string) => {
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
        // No message POST has been attempted. Preserve the text even if chat
        // creation failed, without discarding what was typed during that wait.
        const store = useChatSyncStore.getState()
        const newerDraft = store.localChatState.drafts[chatId]
        store.setDraftText(chatId, newerDraft ? `${content}\n\n${newerDraft}` : content)
        return
      }
      // Attach MCP servers and env vars staged while this was a draft. Await
      // them before the real chat is selected below (pickers read them then)
      // and before the first message (the server loads them when the turn
      // starts).
      const draftConfig = useChatSyncStore.getState().draftChatConfig
      await applyPendingMcpServers(materializedChat.id, {
        servers: draftConfig?.id === chatId ? draftConfig.pendingMcpServers : undefined,
        clearPending: () => useChatSyncStore.getState().updateDraftChatConfig({ pendingMcpServers: undefined }),
      })
      await applyPendingEnvVars(materializedChat.id, {
        environmentVariables: draftConfig?.id === chatId ? draftConfig.pendingEnvironmentVariables : undefined,
        clearPending: () => useChatSyncStore.getState().updateDraftChatConfig({ pendingEnvironmentVariables: undefined }),
      })
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
      const userMessage: Message = { id: nanoid(), role: "user", content, timestamp: now, metadata: { reasoningEffort: reasoningEffort ?? "default" } }
      const assistantMessage: Message = { id: nanoid(), role: "assistant", content: "", timestamp: now + 1, toolCalls: [], contentBlocks: [] }

      // Optimistic update. Retry resends a prompt that just failed, so it
      // replaces that bubble instead of showing the prompt twice.
      updateChatsCache((old) => old.map((c) => {
        if (c.id !== chatId) return c
        const failed = c.status === "error" ? c.messages.at(-1) : undefined
        const messages = failed?.role === "user" && failed.content === content ? c.messages.slice(0, -1) : c.messages
        return applyOptimisticSend({ ...c, messages }, userMessage, assistantMessage, now)
      }))

      // Switch to the real chat in the same synchronous block as the optimistic
      // update above, so both commit in one render (no empty-chat flash).
      if (draftIdToActivate) {
        useChatSyncStore.getState().completeMaterialize(draftIdToActivate, chatId)
      }

      // Clear only this POST's flag, even after an authoritative acknowledgment.
      // A remounted hook may have started a newer local POST in the meantime.
      const settlePendingSend = () => updateChatsCache((old) => old.map((c) =>
        c.id === chatId && c.pendingSendAssistantMessageId === assistantMessage.id
          ? { ...c, pendingSend: false, pendingSendAssistantMessageId: undefined } : c
      ))

      try {
        const payload: SendMessagePayload = {
          message: content,
          agent: selectedAgent,
          model: selectedModel,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          timestamp: now,
          newBranch: newBranchForSend(chat),
          planMode: planMode || undefined,
          reasoningEffort,
        }

        const result = await sendMessageToApi(chatId, payload, files)
        settlePendingSend()

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
            const store = useChatSyncStore.getState()
            const newerDraft = store.localChatState.drafts[chatId]
            store.setDraftText(chatId, newerDraft ? `${content}\n\n${newerDraft}` : content)
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

          if (result.isChatBusy) {
            // The server did not persist this turn. Remove the optimistic
            // bubbles and put the text back where the user can retry it.
            updateChatsCache((old) => old.map((c) =>
              c.id === chatId ? removeOptimisticMessages(c, [userMessage.id, assistantMessage.id]) : c
            ))
            const store = useChatSyncStore.getState()
            const currentDraft = store.localChatState.drafts[chatId]
            store.setDraftText(chatId, currentDraft ? `${content}\n\n${currentDraft}` : content)
            await queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
            await reloadMessages(chatId)
            return
          }

          throw new Error(result.error)
        }

        const { data } = result
        const owner = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.find((c) => c.id === chatId)
        // A delayed response for A must not replace B or revive a turn which
        // an authoritative read has already confirmed finished.
        if (owner?.activeAssistantMessageId !== assistantMessage.id) return
        updateChatsCache((old) => old.map((c) =>
          c.id === chatId ? applySendSuccess(c, data, selectedAgent, selectedModel, userMessage.id) : c
        ))

        startStreaming(chatId, data.sandboxId, "project", data.backgroundSessionId, assistantMessage.id, data.previewUrlPattern ?? undefined, data.branch, undefined, planMode)

        if (isFirstMessage) {
          suggestNameMutation.mutate({ chatId, prompt: content })
        }
      } catch (error) {
        settlePendingSend()
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        // Keep the prompt on screen with the error, so Retry can send it again.
        // Skip this if another turn took over or the server already answered.
        updateChatsCache((old) => old.map((c) => {
          if (c.id !== chatId || (c.activeAssistantMessageId && c.activeAssistantMessageId !== assistantMessage.id)) return c
          const reply = c.messages.find((message) => message.id === assistantMessage.id)
          if (reply?.content || reply?.toolCalls?.length) return c
          return { ...c, status: "error", pendingSend: false, errorMessage,
            messages: c.messages.filter((message) => message.id !== assistantMessage.id) }
        }))
        // The response may have been lost after the server saved the turn. If it
        // has our message, show the real state instead of offering a resend.
        const observed = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.find((c) => c.id === chatId)
        try {
          const saved = await fetchChat(chatId)
          if (observed && saved.messages.some((message) => message.id === userMessage.id)) {
            updateChatsCache((old) => old.map((c) => c.id === chatId ? applyRecoveredChat(c, saved, observed) : c))
          }
        } catch (readError) {
          console.warn("[message-dispatch] Could not check whether the failed send was saved:", readError)
        }
      }
    } finally {
      sendInFlight.current.delete(chatId)
    }
  }, [currentChatId, chats, session, settings, credentialFlags, updateChatsCache, startStreaming, suggestNameMutation, isDraftChatId, materializeDraft, queryClient, reloadMessages, setLimitReachedState, onConflictStateChangeRef])

  // Queue management is server-owned; this hook syncs it across browsers.
  const { enqueueMessage, removeQueuedMessage, resumeQueue } = useServerQueue({
    isHydrated,
    isAuthenticated: !!session,
    currentChat,
  })

  const stopAgent = useCallback(async () => {
    if (!currentChat) return

    const chatId = currentChat.id
    if (stopInFlight.current.has(chatId)) return
    const backgroundSessionId = currentChat.backgroundSessionId
    const assistantMessageId = currentChat.activeAssistantMessageId
    if (!backgroundSessionId || !assistantMessageId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
      return
    }

    // Prevent sending messages while stop is in progress
    stopInFlight.current.add(chatId)
    updateChatsCache((old) => old.map((chat) => chat.id === chatId ? { ...chat, stopPending: true } : chat))

    // Call the stop endpoint and wait for it to complete before allowing new messages
    try {
      const response = await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, backgroundSessionId, assistantMessageId }),
      })
      if (response.status === 409) {
        useToastStore.getState().addToast({ title: "This turn is already finishing", body: "Refreshing the chat. A newer turn will not be stopped.", chatId })
        await reloadMessages(chatId)
        await queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
        return
      }
      if (!response.ok) throw new Error(`Stop failed (HTTP ${response.status})`)
      const stream = useStreamStore.getState().getStream(chatId)
      if (stream?.connectionParams?.backgroundSessionId === backgroundSessionId &&
          stream.connectionParams.assistantMessageId === assistantMessageId) {
        useStreamStore.getState().stopStream(chatId)
      }
      updateChatsCache((old) => old.map((c) =>
        c.id === chatId && c.backgroundSessionId === backgroundSessionId && c.activeAssistantMessageId === assistantMessageId
          ? { ...c, status: "ready", backgroundSessionId: undefined, activeAssistantMessageId: undefined, queuePaused: true }
          : c
      ))
      await reloadMessages(chatId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
    } catch (err) {
      console.error("[stopAgent] Failed to stop agent:", err)
      useToastStore.getState().addToast({ title: "Could not confirm Stop", body: "Refreshing the chat. If the agent is still running, try Stop again.", chatId })
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
      await reloadMessages(chatId)
    } finally {
      stopInFlight.current.delete(chatId)
      updateChatsCache((old) => old.map((chat) => chat.id === chatId ? { ...chat, stopPending: false } : chat))
    }
  }, [currentChat, updateChatsCache, queryClient, reloadMessages])

  return { sendMessage, stopAgent, enqueueMessage, removeQueuedMessage, resumeQueue }
}
