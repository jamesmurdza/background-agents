"use client"

import { useCallback } from "react"
import { useSession } from "next-auth/react"
import { NEW_REPOSITORY, isRealRepo, type Chat, type ChatStatus } from "@/lib/types"
import { savePendingMessage } from "@/lib/pending-message"

interface UseBranchingOptions {
  currentChat: Chat | null
  /** All chats — used to resolve an arbitrary source chat for `handleBranchFromChat`. */
  chats: Chat[]
  startNewChat: (
    repo?: string,
    baseBranch?: string,
    parentChatId?: string,
    switchTo?: boolean,
    initialStatus?: ChatStatus,
    agent?: string | null,
    model?: string | null
  ) => Promise<string | null>
  sendMessage: (
    message: string,
    agent?: string,
    model?: string,
    files?: File[],
    chatId?: string,
    planMode?: boolean
  ) => unknown
  removeQueuedMessage: (id: string) => void
  openSignInModal: (open: boolean) => void
}

interface UseBranchingResult {
  /** Whether the current chat is in a state where branching is allowed. */
  canBranch: boolean
  /** "Branch this chat" — create a sibling chat off the current branch and switch to it. */
  handleBranchChat: () => void
  /**
   * "Branch this chat" for an arbitrary chat (e.g. from the sidebar "…" menu):
   * create a sibling off the given chat's branch and switch to it.
   */
  handleBranchFromChat: (sourceChatId: string) => void
  /**
   * "Branch + send" (Option+Enter): create a sibling chat off the current branch,
   * dispatch the message to it in the background, and stay on the current chat.
   * If the user isn't signed in, the message is staged for replay after OAuth.
   */
  handleBranchWithMessage: (message: string, agent: string, model: string) => Promise<void>
  /**
   * Branch a *queued* message into a new background chat. Removes the queued
   * message first so it doesn't fire twice (once on the current chat when the
   * queue resumes, once on the new chat).
   */
  handleBranchQueuedMessage: (
    id: string,
    message: string,
    agent?: string,
    model?: string
  ) => Promise<void>
}

/**
 * Owns the "branch this chat" family of actions. A branch creates a *sibling*
 * chat — same repo, same starting branch (we use the working branch if a
 * sandbox exists, otherwise the configured base branch), with `parentChatId`
 * pointing back at the source.
 *
 * Three flavors share one helper:
 *   - `handleBranchChat`: bare branch, switch to it.
 *   - `handleBranchWithMessage`: branch + dispatch in background.
 *   - `handleBranchQueuedMessage`: dequeue + branch + dispatch in background.
 *
 * Sign-in interception is handled here too: an unauthenticated user gets the
 * sign-in modal, and (for the "with message" flavor) the message is stashed
 * for OAuth replay.
 */
export function useBranching({
  currentChat,
  chats,
  startNewChat,
  sendMessage,
  removeQueuedMessage,
  openSignInModal,
}: UseBranchingOptions): UseBranchingResult {
  const { data: session } = useSession()

  // Use the working branch if the sandbox is up; otherwise the base branch the
  // chat was configured with (before any messages were sent).
  const branchForNewChat = currentChat?.branch || currentChat?.baseBranch
  const canBranch = !!branchForNewChat && isRealRepo(currentChat?.repo)

  // Shared helper: create the new chat (optionally) and dispatch a message to
  // it. Branches off `sourceChat` (defaults to the current chat). Returns false
  // if branch creation is not possible or was aborted (e.g. user needs to sign in).
  const createBranchAndSend = useCallback(
    async (options?: {
      message?: string
      agent?: string
      model?: string
      /** Chat to branch off. Defaults to the current chat. */
      sourceChat?: Chat | null
      /** If true, save the message for retry after sign-in */
      savePendingOnAuth?: boolean
    }): Promise<boolean> => {
      const source = options?.sourceChat ?? currentChat
      const sourceBranch = source?.branch || source?.baseBranch
      if (!source || !sourceBranch || source.repo === NEW_REPOSITORY) return false
      if (!session) {
        if (options?.savePendingOnAuth && options.message && options.agent && options.model) {
          savePendingMessage({
            message: options.message,
            agent: options.agent,
            model: options.model,
          })
        }
        openSignInModal(true)
        return false
      }
      // When no message is provided, navigate to the new chat
      const navigateToChat = !options?.message
      // Use provided agent/model or inherit from the source chat
      const agentToUse = options?.agent ?? source.agent
      const modelToUse = options?.model ?? source.model
      // Create new chat in "pending" state (allows sendMessage) without switching to it
      const chatId = await startNewChat(
        source.repo,
        sourceBranch,
        source.id,
        navigateToChat,
        navigateToChat ? undefined : "pending",
        agentToUse,
        modelToUse
      )
      if (!chatId) return false
      // Send message to the new chat if provided (it runs in background)
      if (options?.message) {
        sendMessage(options.message, options.agent, options.model, undefined, chatId)
      }
      return true
    },
    [currentChat, startNewChat, sendMessage, session, openSignInModal]
  )

  const handleBranchChat = useCallback(() => {
    void createBranchAndSend()
  }, [createBranchAndSend])

  const handleBranchFromChat = useCallback(
    (sourceChatId: string) => {
      const sourceChat = chats.find((c) => c.id === sourceChatId) ?? null
      void createBranchAndSend({ sourceChat })
    },
    [chats, createBranchAndSend]
  )

  const handleBranchWithMessage = useCallback(
    async (message: string, agent: string, model: string) => {
      await createBranchAndSend({ message, agent, model, savePendingOnAuth: true })
    },
    [createBranchAndSend]
  )

  const handleBranchQueuedMessage = useCallback(
    async (id: string, message: string, agent?: string, model?: string) => {
      // Remove from queue first so it doesn't fire on the current chat too
      removeQueuedMessage(id)
      await createBranchAndSend({ message, agent, model })
    },
    [createBranchAndSend, removeQueuedMessage]
  )

  return {
    canBranch,
    handleBranchChat,
    handleBranchFromChat,
    handleBranchWithMessage,
    handleBranchQueuedMessage,
  }
}
