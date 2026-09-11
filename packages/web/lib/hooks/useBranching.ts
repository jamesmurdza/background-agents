"use client"

import { useCallback } from "react"
import { useSession } from "next-auth/react"
import { useQueryClient } from "@tanstack/react-query"
import { NEW_REPOSITORY, isRealRepo, type Chat, type ChatStatus } from "@/lib/types"
import { savePendingMessage } from "@/lib/pending-message"
import { fetchBranches } from "@/lib/github"
import { queryKeys } from "@/lib/query/keys"
import { useToastStore } from "@/lib/stores/toast-store"

/**
 * A chat with a live sandbox branches off its *working* branch, and the new
 * chat's sandbox clones that branch from GitHub. Until a commit has been pushed
 * the branch only exists inside the old sandbox, so there is nothing to clone
 * and the branch chat would fail on creation.
 *
 * Checked on demand rather than tracked, since it's one call on a rare click.
 * A check that can't complete (offline, GitHub hiccup) doesn't block branching:
 * this is an early warning, not a gate.
 */
async function branchIsOnGitHub(
  queryClient: ReturnType<typeof useQueryClient>,
  repo: string,
  branch: string
): Promise<boolean> {
  const [owner, name] = repo.split("/")
  if (!owner || !name) return true
  try {
    const branches = await queryClient.fetchQuery({
      queryKey: queryKeys.github.branches(owner, name),
      queryFn: () => fetchBranches(owner, name),
      // The agent may have pushed seconds ago; a cached list would be wrong.
      staleTime: 0,
    })
    return branches.some((b) => b.name === branch)
  } catch {
    return true
  }
}

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
  const queryClient = useQueryClient()

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
      // Nothing has been pushed to the working branch yet — say so instead of
      // creating a branch chat whose sandbox can't clone it.
      if (source.branch && !(await branchIsOnGitHub(queryClient, source.repo, source.branch))) {
        useToastStore.getState().addToast({
          title: "Nothing committed yet",
          body: `${source.branch} isn't on GitHub yet, so there's nothing to branch from. Branch again once the agent has committed and pushed.`,
        })
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
    [currentChat, startNewChat, sendMessage, session, openSignInModal, queryClient]
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
