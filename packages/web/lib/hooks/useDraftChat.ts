"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { nanoid } from "nanoid"
import { useSession } from "next-auth/react"
import {
  NEW_REPOSITORY,
  resolveAgentAndModel,
  type Chat,
  type CredentialFlags,
  type Message,
  type Settings,
} from "@/lib/types"

interface DraftChatConfig {
  id: string
  repo: string
  baseBranch: string
  agent: string | null
  model: string | null
  planMode?: boolean
}

type DraftChatConfigUpdates = Partial<{
  repo: string
  baseBranch: string
  agent: string | null
  model: string | null
  planMode?: boolean
}>

interface OptimisticDraft {
  chatId: string
  messages: Message[]
}

interface UseDraftChatOptions {
  isHydrated: boolean
  currentChat: Chat | null
  currentChatId: string | null
  settings: Settings
  credentialFlags: CredentialFlags
  draftChatConfig: DraftChatConfig | null | undefined
  isDraftChatId: (chatId: string) => boolean
  updateDraftChatConfig: (updates: DraftChatConfigUpdates) => void
  updateCurrentChat: (updates: Partial<Chat>) => void
  /** Promote a draft chat to a real DB-backed chat. */
  materializeDraft: (
    draftId: string,
    options?: { status?: Chat["status"] }
  ) => Promise<Chat | null>
  /** Per-chat draft input text (real chats only — keyed by chatId). */
  drafts: Record<string, string>
  updateDraft: (chatId: string, draft: string) => void
}

interface UseDraftChatResult {
  /** The unified "current chat" — either the real currentChat or a synthetic draft. */
  displayCurrentChat: Chat | null
  /** True when we're rendering a synthetic draft chat (no DB row yet). */
  isDraftMode: boolean
  /** True when we're in draft mode AND the user is authenticated. */
  isAuthenticatedDraft: boolean
  /** Update handler that routes to draft state when in draft mode, otherwise updates the real chat. */
  handleUpdateChatProp: (updates: Partial<Chat>) => void
  /** Per-chat draft input text (read). */
  currentDraft: string
  /** Per-chat draft input text (write). */
  handleDraftChange: (draft: string) => void
  /** Optimistic message bubble shown on a just-sent draft so the welcome screen leaves instantly. */
  optimisticDraft: OptimisticDraft | null
  setOptimisticDraft: React.Dispatch<React.SetStateAction<OptimisticDraft | null>>
  /**
   * Materialize the draft chat for the MCP modal (it can't persist changes
   * against a non-existent chat row). Returns the real chatId or null on failure.
   */
  handleMaterializeDraftForMcp: (draftId: string) => Promise<string | null>
}

/**
 * Encapsulates the synthetic "draft chat" lifecycle: state, the displayCurrentChat
 * derivation, optimistic-message bookkeeping, and the agent/model/repo write
 * routing that depends on whether we're editing a real row or a draft.
 *
 * Two flavors of draft exist:
 *   - **Unauthenticated draft**: no session yet. Agent/model are held in local
 *     component state because there's no chat row (and no draftChatConfig)
 *     to PATCH.
 *   - **Authenticated draft**: user is signed in but hasn't sent the first
 *     message yet. Agent/model/repo live in `draftChatConfig` (persisted to
 *     localStorage via useChatWithSync) so they survive a reload.
 */
export function useDraftChat({
  isHydrated,
  currentChat,
  currentChatId,
  settings,
  credentialFlags,
  draftChatConfig,
  isDraftChatId,
  updateDraftChatConfig,
  updateCurrentChat,
  materializeDraft,
  drafts,
  updateDraft,
}: UseDraftChatOptions): UseDraftChatResult {
  const { data: session } = useSession()

  // Optimistic messages shown on a draft chat the instant the user sends, so the
  // view leaves the "new chat" welcome screen immediately instead of waiting for
  // the draft to be materialized on the server. Keyed by the draft's chat id.
  const [optimisticDraft, setOptimisticDraft] = useState<OptimisticDraft | null>(null)

  // Draft chat agent/model — only used when an unauthenticated user is
  // composing a message before any real chat exists. Stored locally because
  // the chat row that would normally hold these doesn't exist yet.
  const [draftAgent, setDraftAgent] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState<string | null>(null)

  // Per-chat draft message text — for authenticated users this comes from
  // localStorage-backed drafts via useChatWithSync; for unauthenticated users
  // (no chat row to key by) we hold it in component state.
  const [draftModeInput, setDraftModeInput] = useState("")

  // Stable id used as a placeholder until a real currentChatId exists.
  const unauthDraftIdRef = useRef<string>(`draft-${nanoid()}`)

  const draftChat: Chat | null = useMemo(() => {
    if (!isHydrated) return null

    // Optimistic messages for a just-sent draft (so the conversation view shows
    // instantly while the draft is materialized on the server).
    const messagesFor = (id: string) =>
      optimisticDraft && optimisticDraft.chatId === id ? optimisticDraft.messages : []

    // Case 1: Unauthenticated user - use local draft state
    // This applies when there's no session AND either no chat ID or the chat ID is a draft
    if (!session && (!currentChatId || isDraftChatId(currentChatId))) {
      // Local dropdown state wins; fall back to the store draft config so a
      // preselected agent (e.g. from an /agent/:slug deep link, baked in via
      // enterDraftMode) still applies before the user touches anything.
      const { agent: resolvedAgent, model: resolvedModel } =
        resolveAgentAndModel(
          draftAgent ?? draftChatConfig?.agent,
          draftModel ?? draftChatConfig?.model,
          settings,
          credentialFlags
        )
      return {
        id: currentChatId ?? unauthDraftIdRef.current,
        repo: NEW_REPOSITORY,
        baseBranch: "main",
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: resolvedAgent,
        model: resolvedModel,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending",
        displayName: null,
      }
    }

    // Case 2: Authenticated user with a draft chat ID - use draftChatConfig
    if (session && currentChatId && isDraftChatId(currentChatId) && draftChatConfig) {
      const { agent: resolvedAgent, model: resolvedModel } =
        resolveAgentAndModel(draftChatConfig.agent, draftChatConfig.model, settings, credentialFlags)
      const messages = messagesFor(currentChatId)
      return {
        id: currentChatId,
        repo: draftChatConfig.repo,
        baseBranch: draftChatConfig.baseBranch,
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: resolvedAgent,
        model: resolvedModel,
        planModeEnabled: draftChatConfig.planMode ?? false,
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: messages.length > 0 ? "creating" : "pending",
        displayName: null,
      }
    }

    return null
  }, [isHydrated, session, currentChatId, draftAgent, draftModel, settings.defaultAgent, settings.defaultModel, credentialFlags, isDraftChatId, draftChatConfig, optimisticDraft])

  // Unified current chat - either a real chat or a draft chat
  const displayCurrentChat = isHydrated ? (currentChat ?? draftChat) : null
  const isDraftMode = !!draftChat
  const isAuthenticatedDraft = isDraftMode && !!session

  // Drop optimistic draft messages once we've navigated off that draft — e.g. the
  // draft was materialized into a real chat (currentChatId changed) or the user
  // switched chats. The real chat carries its own optimistic messages by then.
  useEffect(() => {
    if (optimisticDraft && optimisticDraft.chatId !== currentChatId) {
      setOptimisticDraft(null)
    }
  }, [currentChatId, optimisticDraft])

  // When in draft mode, agent/model dropdowns route to local draft state
  // because no real chat row exists to PATCH yet.
  const handleUpdateChatProp = useCallback(
    (updates: Partial<Chat>) => {
      if (isDraftMode) {
        if (isAuthenticatedDraft) {
          // Authenticated draft - update via hook (updates both React state and localStorage)
          // Only include defined values to avoid overwriting existing config fields
          const draftUpdates: DraftChatConfigUpdates = {}
          if (updates.agent !== undefined) draftUpdates.agent = updates.agent
          if (updates.model !== undefined) draftUpdates.model = updates.model
          if (updates.repo !== undefined) draftUpdates.repo = updates.repo
          if (updates.baseBranch !== undefined) draftUpdates.baseBranch = updates.baseBranch
          if (updates.planModeEnabled !== undefined) draftUpdates.planMode = updates.planModeEnabled
          updateDraftChatConfig(draftUpdates)
        } else {
          // Unauthenticated draft - use local component state
          if (updates.agent !== undefined) setDraftAgent(updates.agent)
          if (updates.model !== undefined) setDraftModel(updates.model)
        }
        return
      }
      updateCurrentChat(updates)
    },
    [isDraftMode, isAuthenticatedDraft, updateDraftChatConfig, updateCurrentChat]
  )

  // Per-chat draft handling: in draft mode use local state, otherwise use
  // localStorage-backed drafts keyed by chatId.
  const currentDraft = isDraftMode
    ? draftModeInput
    : (currentChatId ? (drafts[currentChatId] ?? "") : "")

  const handleDraftChange = useCallback((draft: string) => {
    if (isDraftMode) {
      setDraftModeInput(draft)
      return
    }
    if (!currentChatId) return
    updateDraft(currentChatId, draft)
  }, [isDraftMode, currentChatId, updateDraft])

  // Materialize the draft chat when the MCP modal needs to commit a change.
  // Returns the real chatId, or null if materialization failed.
  const handleMaterializeDraftForMcp = useCallback(
    async (draftId: string): Promise<string | null> => {
      const materialized = await materializeDraft(draftId)
      return materialized?.id ?? null
    },
    [materializeDraft]
  )

  return {
    displayCurrentChat,
    isDraftMode,
    isAuthenticatedDraft,
    handleUpdateChatProp,
    currentDraft,
    handleDraftChange,
    optimisticDraft,
    setOptimisticDraft,
    handleMaterializeDraftForMcp,
  }
}
