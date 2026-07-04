"use client"

/**
 * Chat-sync store — owns all client-side chat state that used to live as
 * useState/useRef inside useChatWithSync.
 *
 * Why a store: the hook accumulated a pile of refs that existed only to dodge
 * React's stale-closure behaviour (notably draftChatConfigRef). A Zustand store
 * lets actions read fresh state via get(), so that class of ref disappears and
 * the state mutations become plain, testable functions decoupled from render.
 *
 * Server data (chats, settings) still lives in TanStack Query; this store holds
 * only local/client state. The persistence calls (localStorage) are colocated
 * with the action that owns the state.
 */

import { create } from "zustand"
import { nanoid } from "nanoid"
import type { Chat } from "@/lib/types"
import {
  loadLocalState,
  setCurrentChatId as persistCurrentChatId,
  setPreviewState,
  loadUnseenChatIds,
  saveUnseenChatIds,
  setDraft,
  setDraftChatConfig,
  clearDraftChatConfig,
  migrateDraftToRealChat,
  type DraftChatConfig,
} from "@/lib/storage"
import {
  migrateLocalChatState,
  upsertDraft,
  computeNextPreviewState,
  type LocalChatState,
} from "@/lib/chat-state"

export interface LimitReachedState {
  show: boolean
  pendingMessage?: {
    chatId: string
    content: string
    files?: File[]
    planMode?: boolean
  }
  /** Shared-pool provider that hit its limit (claude | gemini | opencode). */
  provider?: string
  /** Unit the budget is measured in (tokens | cost | messages). */
  unit?: "tokens" | "cost" | "messages"
  /** Amount used / daily budget for that provider, in `unit`. */
  used?: number | null
  limit?: number | null
  resetAt?: Date
}

type PreviewUpdate = Pick<Partial<Chat>, "previewItems" | "activePreviewIndex" | "previewPaneHidden">

interface ChatSyncStore {
  // --- Reactive state ---
  currentChatId: string | null
  isHydrated: boolean
  unseenChatIds: Set<string>
  deletingChatIds: Set<string>
  localChatState: LocalChatState
  draftChatConfig: DraftChatConfig | undefined
  limitReachedState: LimitReachedState

  // --- Actions ---
  /** Load persisted local state from localStorage. */
  hydrate: () => void
  /** Select a chat (clears its unseen flag) and persist the selection. */
  selectChat: (chatId: string | null) => void
  /** Set + persist the current chat id. */
  setCurrentChatId: (chatId: string | null) => void
  /** Mark chats unseen (running → done while not open). */
  addUnseen: (ids: string[]) => void
  addDeleting: (ids: string[]) => void
  removeDeleting: (ids: string[]) => void
  /** Functional update of the local chat state (queue/preview/draft maps). */
  setLocalChatState: (updater: (prev: LocalChatState) => LocalChatState) => void
  /** Begin a draft chat; returns its synthetic id. */
  enterDraftMode: (repo: string, baseBranch: string, agent: string | null, model: string | null) => string
  updateDraftChatConfig: (updates: Partial<Omit<DraftChatConfig, "id">>) => void
  /** Finalize a draft → real chat: migrate local state, clear the draft, select the real id. */
  completeMaterialize: (draftId: string, realId: string) => void
  setDraftText: (chatId: string, draft: string | undefined) => void
  setPreviewStateForChat: (chatId: string, updates: PreviewUpdate) => void
  setLimitReachedState: (state: LimitReachedState) => void
  dismissLimitReached: () => void
}

export const useChatSyncStore = create<ChatSyncStore>((set, get) => ({
  currentChatId: null,
  isHydrated: false,
  unseenChatIds: new Set(),
  deletingChatIds: new Set(),
  localChatState: { previewStates: {}, queuedMessages: {}, queuePaused: {}, drafts: {} },
  draftChatConfig: undefined,
  limitReachedState: { show: false },

  hydrate: () => {
    const s = loadLocalState()
    set({
      currentChatId: s.currentChatId,
      unseenChatIds: loadUnseenChatIds(),
      localChatState: {
        previewStates: s.previewStates,
        queuedMessages: s.queuedMessages,
        queuePaused: s.queuePaused,
        drafts: s.drafts,
      },
      draftChatConfig: s.draftChatConfig,
      isHydrated: true,
    })
  },

  selectChat: (chatId) => {
    if (chatId) {
      const prev = get().unseenChatIds
      if (prev.has(chatId)) {
        const next = new Set(prev)
        next.delete(chatId)
        set({ unseenChatIds: next })
        saveUnseenChatIds(next)
      }
    }
    set({ currentChatId: chatId })
    persistCurrentChatId(chatId)
  },

  setCurrentChatId: (chatId) => {
    set({ currentChatId: chatId })
    persistCurrentChatId(chatId)
  },

  addUnseen: (ids) => {
    set((state) => {
      const next = new Set(state.unseenChatIds)
      ids.forEach((id) => next.add(id))
      return { unseenChatIds: next }
    })
    saveUnseenChatIds(get().unseenChatIds)
  },

  addDeleting: (ids) => {
    set((state) => ({ deletingChatIds: new Set([...state.deletingChatIds, ...ids]) }))
  },

  removeDeleting: (ids) => {
    set((state) => {
      const next = new Set(state.deletingChatIds)
      ids.forEach((id) => next.delete(id))
      return { deletingChatIds: next }
    })
  },

  setLocalChatState: (updater) => {
    set((state) => ({ localChatState: updater(state.localChatState) }))
  },

  enterDraftMode: (repo, baseBranch, agent, model) => {
    const draftId = `draft-${nanoid()}`
    const config: DraftChatConfig = { id: draftId, repo, baseBranch, agent, model }
    set({ draftChatConfig: config, currentChatId: draftId })
    setDraftChatConfig(config)
    persistCurrentChatId(draftId)
    return draftId
  },

  updateDraftChatConfig: (updates) => {
    const cur = get().draftChatConfig
    if (!cur) return
    const newConfig: DraftChatConfig = { ...cur, ...updates }
    set({ draftChatConfig: newConfig })
    setDraftChatConfig(newConfig)
  },

  completeMaterialize: (draftId, realId) => {
    migrateDraftToRealChat(draftId, realId)
    set((state) => ({
      localChatState: migrateLocalChatState(state.localChatState, draftId, realId),
      draftChatConfig: undefined,
      // NOTE: currentChatId is set here WITHOUT persisting, matching the prior
      // behaviour of materializeDraft (which never called persistCurrentChatId).
      currentChatId: realId,
    }))
    clearDraftChatConfig()
  },

  setDraftText: (chatId, draft) => {
    setDraft(chatId, draft)
    set((state) => ({
      localChatState: { ...state.localChatState, drafts: upsertDraft(state.localChatState.drafts, chatId, draft) },
    }))
  },

  setPreviewStateForChat: (chatId, updates) => {
    if (
      !("previewItems" in updates) &&
      !("activePreviewIndex" in updates) &&
      !("previewPaneHidden" in updates)
    ) {
      return
    }
    const newState = computeNextPreviewState(get().localChatState.previewStates[chatId], updates)
    setPreviewState(chatId, newState)
    set((state) => {
      const newPreviewStates = { ...state.localChatState.previewStates }
      if (newState === undefined) {
        delete newPreviewStates[chatId]
      } else {
        newPreviewStates[chatId] = newState
      }
      return { localChatState: { ...state.localChatState, previewStates: newPreviewStates } }
    })
  },

  setLimitReachedState: (state) => set({ limitReachedState: state }),
  dismissLimitReached: () => set({ limitReachedState: { show: false } }),
}))
