"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import type { Chat } from "@/lib/types"
import { loadAndClearPendingMessage } from "@/lib/pending-message"

interface UsePendingMessageReplayOptions {
  isHydrated: boolean
  chats: Chat[]
  currentChatId: string | null
  startNewChat: () => Promise<string | null>
  sendMessage: (
    message: string,
    agent: string,
    model: string,
    files?: File[],
    chatId?: string
  ) => void
  updateChatById: (chatId: string, updates: Partial<Chat>) => Promise<void>
  /** Fired once we've decided to replay — used to close the sign-in modal. */
  onReplayBegin?: () => void
}

interface PendingSend {
  chatId: string
  message: string
  agent: string
  model: string
}

/**
 * Replays a message the user composed *before* signing in.
 *
 * Flow: an unauthenticated user types a message, hits send → we stash it in
 * sessionStorage and route through GitHub OAuth → on return, this hook detects
 * the stashed message and replays it.
 *
 * Implemented as two coordinated effects to avoid a stale-closure race:
 *
 *   (a) **load effect**: once session + hydration are ready, load the pending
 *       message, ensure a chat exists, and stage a `PendingSend` referencing
 *       the resolved chat id.
 *
 *   (b) **send effect**: fires once `chats` actually contains the staged chat,
 *       so `sendMessage`'s captured state is fresh enough to locate it.
 *       Calls sendMessage and clears the staging state.
 *
 * The `pendingMessageProcessed` ref guards against the load effect re-running
 * (chats/currentChatId churn during sign-in could otherwise cause double-sends).
 */
export function usePendingMessageReplay({
  isHydrated,
  chats,
  currentChatId,
  startNewChat,
  sendMessage,
  updateChatById,
  onReplayBegin,
}: UsePendingMessageReplayOptions): void {
  const { data: session } = useSession()

  // Track whether we've already consumed the pending message this session, so
  // re-renders from chats/currentChatId updates don't cause a second replay.
  const pendingMessageProcessed = useRef(false)

  // Staged send — set once the chat exists, drained once it shows up in `chats`.
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)

  // (a) Load-and-stage
  useEffect(() => {
    if (!session || !isHydrated || pendingMessageProcessed.current) return

    const pending = loadAndClearPendingMessage()
    if (!pending) return

    pendingMessageProcessed.current = true
    onReplayBegin?.()

    void (async () => {
      let chatId = currentChatId
      if (!chatId) {
        chatId = await startNewChat()
        if (!chatId) return
      }
      // Persist the agent/model picked in draft mode so subsequent
      // messages on this chat use them too. Best-effort.
      updateChatById(chatId, {
        agent: pending.agent,
        model: pending.model,
      }).catch(() => {})
      setPendingSend({
        chatId,
        message: pending.message,
        agent: pending.agent,
        model: pending.model,
      })
    })()
  }, [session, isHydrated, startNewChat, updateChatById, currentChatId, onReplayBegin])

  // (b) Send-when-chat-visible
  useEffect(() => {
    if (!pendingSend) return
    if (!chats.some((c) => c.id === pendingSend.chatId)) return
    const { message, agent, model, chatId } = pendingSend
    setPendingSend(null)
    sendMessage(message, agent, model, undefined, chatId)
  }, [pendingSend, chats, sendMessage])
}
