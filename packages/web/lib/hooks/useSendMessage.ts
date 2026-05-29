"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { nanoid } from "nanoid"
import {
  NEW_REPOSITORY,
  type Chat,
  type ChatStatus,
  type Message,
} from "@/lib/types"
import { ALL_REPOSITORIES, NO_REPOSITORY } from "@/lib/contexts"
import { savePendingMessage } from "@/lib/pending-message"

interface OptimisticDraft {
  chatId: string
  messages: Message[]
}

/** Subset of the sidebar context that affects sending behavior. */
interface SidebarRepoFilter {
  repoFilter: string
  setRepoFilter: (filter: string) => void
}

interface UseSendMessageOptions {
  rapidFireMode: boolean
  sidebar: SidebarRepoFilter
  displayCurrentChat: Chat | null
  currentChatId: string | null
  isDraftMode: boolean
  sendMessage: (
    message: string,
    agent: string,
    model: string,
    files?: File[],
    chatId?: string,
    planMode?: boolean
  ) => unknown
  startNewChat: (
    repo?: string,
    baseBranch?: string,
    parentChatId?: string,
    switchTo?: boolean,
    initialStatus?: ChatStatus,
    agent?: string | null,
    model?: string | null
  ) => Promise<string | null>
  setOptimisticDraft: React.Dispatch<React.SetStateAction<OptimisticDraft | null>>
  openSignInModal: (open: boolean) => void
}

interface UseSendMessageResult {
  /** Submit a message — handles draft materialization, rapid-fire routing, and sign-in interception. */
  handleSendMessage: (
    message: string,
    agent: string,
    model: string,
    files?: File[],
    planMode?: boolean
  ) => void
  /** True while we've initiated a send but the server hasn't yet responded with an optimistic update. */
  isSendingMessage: boolean
  /** Timestamp of last rapid-fire-mode send (0 = none). Drives the toast. */
  rapidFireNotification: number
}

/**
 * Owns the "user clicked send" flow.
 *
 * Branches:
 *  - **unauth**: stash the message in sessionStorage, open sign-in modal
 *    (replay happens via usePendingMessageReplay on return).
 *  - **rapid fire**: create a new background chat and dispatch, without
 *    switching away from the current one. Notification timestamp is published
 *    so the caller can flash a toast.
 *  - **normal**: optionally narrow the sidebar repo filter to match this chat
 *    (when this is the first message), set the "sending" flag for instant
 *    feedback, and dispatch. In draft mode we also paint an optimistic user
 *    message so the welcome screen exits before the server materializes the
 *    draft.
 *
 * `isSendingMessage` is auto-cleared when the chat status transitions to
 * "creating"/"running" (server acknowledged) or when the user switches chats.
 */
export function useSendMessage({
  rapidFireMode,
  sidebar,
  displayCurrentChat,
  currentChatId,
  isDraftMode,
  sendMessage,
  startNewChat,
  setOptimisticDraft,
  openSignInModal,
}: UseSendMessageOptions): UseSendMessageResult {
  const { data: session } = useSession()

  // Tracks "user hit send but the server hasn't acknowledged yet" — gives the
  // input bar a busy state instantly rather than waiting for the round-trip.
  const [isSendingMessage, setIsSendingMessage] = useState(false)

  // Timestamp of last rapid-fire send, 0 means no notification active. Caller
  // reads this to flash a "queued in background" toast.
  const [rapidFireNotification, setRapidFireNotification] = useState(0)

  // Clear isSendingMessage once the chat status changes (server responded with
  // optimistic update) or when the user switches to a different chat.
  useEffect(() => {
    if (displayCurrentChat?.status === "creating" || displayCurrentChat?.status === "running") {
      setIsSendingMessage(false)
    }
  }, [displayCurrentChat?.status])

  useEffect(() => {
    // Reset sending state when switching chats
    setIsSendingMessage(false)
  }, [displayCurrentChat?.id])

  // Rapid fire: send as a new background chat without switching to it.
  const handleRapidFireSend = useCallback(
    async (
      message: string,
      agent: string,
      model: string,
      files?: File[],
      planMode?: boolean
    ) => {
      if (!session) {
        savePendingMessage({ message, agent, model })
        openSignInModal(true)
        return
      }

      const repo = displayCurrentChat?.repo ?? NEW_REPOSITORY
      const baseBranch = displayCurrentChat?.baseBranch ?? "main"

      const chatId = await startNewChat(repo, baseBranch, undefined, false, "pending", agent, model)
      if (!chatId) return

      sendMessage(message, agent, model, files, chatId, planMode)
      setRapidFireNotification(Date.now())
    },
    [session, displayCurrentChat, startNewChat, sendMessage, openSignInModal]
  )

  const handleSendMessage = useCallback(
    (
      message: string,
      agent: string,
      model: string,
      files?: File[],
      planMode?: boolean
    ) => {
      // Always require sign-in to send messages
      if (!session) {
        // Store the pending message in sessionStorage (persists across OAuth redirect).
        // Note: files cannot be persisted, so we warn the user if they have attachments.
        savePendingMessage({ message, agent, model })
        openSignInModal(true)
        return
      }

      // Rapid fire mode: send as background task without switching
      if (rapidFireMode) {
        handleRapidFireSend(message, agent, model, files, planMode)
        return
      }

      // Update filter to match the chat's repo if this is the first message and
      // repo differs from filter. Ensures the filter follows the user's choice
      // when starting a chat.
      if (
        displayCurrentChat &&
        displayCurrentChat.messages.length === 0 &&
        sidebar.repoFilter !== ALL_REPOSITORIES &&
        sidebar.repoFilter !== displayCurrentChat.repo
      ) {
        // If chat has no repo, switch to "No repository" filter; otherwise switch to the chat's repo.
        if (displayCurrentChat.repo === NEW_REPOSITORY) {
          sidebar.setRepoFilter(NO_REPOSITORY)
        } else {
          sidebar.setRepoFilter(displayCurrentChat.repo)
        }
      }

      // Set sending state immediately for instant UI feedback
      setIsSendingMessage(true)

      // In draft mode, optimistically render the conversation so the UI leaves
      // the "new chat" welcome screen immediately rather than waiting for the
      // draft to be materialized on the server. (sendMessage materializes the
      // draft, which is a server round-trip, before it can add the real
      // optimistic messages.)
      const draftId = isDraftMode && currentChatId ? currentChatId : null
      if (draftId) {
        // Only the user message is needed to leave the welcome screen
        // (messages.length > 0). The assistant's "thinking" state is shown by
        // the separate `...` indicator driven by the chat's "creating" status.
        setOptimisticDraft({
          chatId: draftId,
          messages: [
            {
              id: `optimistic-user-${nanoid()}`,
              role: "user",
              content: message,
              timestamp: Date.now(),
            },
          ],
        })
      }

      const sendResult = sendMessage(message, agent, model, files, undefined, planMode)

      // Once the send settles, drop the optimistic draft messages. On success
      // the real chat is already showing (currentChatId changed, so the
      // useDraftChat cleanup effect has cleared them); on failure this reverts
      // the view to the welcome screen.
      if (draftId) {
        void Promise.resolve(sendResult).finally(() => {
          setOptimisticDraft((cur) => (cur && cur.chatId === draftId ? null : cur))
        })
      }
    },
    [
      session,
      rapidFireMode,
      sidebar,
      displayCurrentChat,
      currentChatId,
      isDraftMode,
      sendMessage,
      setOptimisticDraft,
      openSignInModal,
      handleRapidFireSend,
    ]
  )

  return {
    handleSendMessage,
    isSendingMessage,
    rapidFireNotification,
  }
}
