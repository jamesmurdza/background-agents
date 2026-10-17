"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { nanoid } from "nanoid"
import {
  NEW_REPOSITORY,
  type Chat,
  type Message,
} from "@/lib/types"
import { ALL_REPOSITORIES, NO_REPOSITORY } from "@/lib/contexts"
import { savePendingMessage } from "@/lib/pending-message"
import type { MessageDispatch, SendMessageOptions, SendMessageResult } from "./useMessageDispatch"

export type HandleSendMessage = (
  message: string, agent: string, model: string, files?: File[], planMode?: boolean,
  thinking?: string, options?: SendMessageOptions
) => Promise<SendMessageResult>

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
  sidebar: SidebarRepoFilter
  displayCurrentChat: Chat | null
  currentChatId: string | null
  isDraftMode: boolean
  sendMessage: MessageDispatch["sendMessage"]
  setOptimisticDraft: React.Dispatch<React.SetStateAction<OptimisticDraft | null>>
  openSignInModal: (open: boolean) => void
}

interface UseSendMessageResult {
  /** Submit a message — handles draft materialization and sign-in interception. */
  handleSendMessage: HandleSendMessage
  /** True while we've initiated a send but the server hasn't yet responded with an optimistic update. */
  isSendingMessage: boolean
}

/**
 * Owns the "user clicked send" flow.
 *
 * Branches:
 *  - **unauth**: stash the message in sessionStorage, open sign-in modal
 *    (replay happens via usePendingMessageReplay on return).
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
  sidebar,
  displayCurrentChat,
  currentChatId,
  isDraftMode,
  sendMessage,
  setOptimisticDraft,
  openSignInModal,
}: UseSendMessageOptions): UseSendMessageResult {
  const { data: session } = useSession()

  // Tracks "user hit send but the server hasn't acknowledged yet" — gives the
  // input bar a busy state instantly rather than waiting for the round-trip.
  const [isSendingMessage, setIsSendingMessage] = useState(false)

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

  const handleSendMessage = useCallback(
    async (
      message: string,
      agent: string,
      model: string,
      files?: File[],
      planMode?: boolean,
      thinking?: string,
      options?: SendMessageOptions
    ): Promise<SendMessageResult> => {
      // Always require sign-in to send messages
      if (!session) {
        // Store the pending message in sessionStorage (persists across OAuth redirect).
        // Note: files cannot be persisted, so we warn the user if they have attachments.
        // Recovery dialogs retain prompt/files and require explicit consent
        // again after login; the ordinary composer keeps OAuth replay behavior.
        if (!options?.callerOwnsRecovery) savePendingMessage({ message, agent, model, thinking })
        openSignInModal(true)
        return { status: "blocked", reason: "unauthenticated", message: "Sign in again before retrying. This retry is kept in this open page. A full-page sign-in redirect or refresh loses the unsent selection and attachment files; reselect and reattach them if needed." }
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

      try {
        const result = await sendMessage(message, agent, model, files, undefined, planMode, undefined, thinking, options)
        if (result.status === "blocked" && result.reason === "unauthenticated") openSignInModal(true)
        return result
      } finally {
        // Return the actual dispatch outcome to callers. A known rejection
        // must leave recovery retryable; an exception must stay uncertain.
        setIsSendingMessage(false)
        if (draftId) setOptimisticDraft((cur) => (cur && cur.chatId === draftId ? null : cur))
      }
    },
    [
      session,
      sidebar,
      displayCurrentChat,
      currentChatId,
      isDraftMode,
      sendMessage,
      setOptimisticDraft,
      openSignInModal,
    ]
  )

  return {
    handleSendMessage,
    isSendingMessage,
  }
}
