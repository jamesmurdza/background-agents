/**
 * LocalStorage utilities for Simple Chat
 *
 * Only device-specific state is stored here:
 * - currentChatId, previewItems, queuedMessages, queuePaused, drafts
 * - unseenChatIds
 *
 * Server data (chats, messages, settings) is managed by TanStack Query.
 */

import type { Chat, Settings } from "./types"

// =============================================================================
// Storage Keys
// =============================================================================

const LOCAL_STATE_KEY = "simple-chat-local"
const UNSEEN_KEY = "simple-chat-unseen-completions"

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for a draft chat (not yet created in database)
 */
export interface DraftChatConfig {
  id: string // draft-{nanoid} - used for local keying only
  repo: string
  baseBranch: string
  agent: string | null
  model: string | null
}

/** Preview state for a chat */
export interface PreviewState {
  items: Chat["previewItems"]
  activeIndex: number
}

/**
 * Device-specific state that stays in localStorage (NOT synced to server)
 */
export interface LocalState {
  currentChatId: string | null
  previewStates: Record<string, PreviewState>
  queuedMessages: Record<string, Chat["queuedMessages"]>
  queuePaused: Record<string, boolean>
  drafts: Record<string, string>
  draftChatConfig?: DraftChatConfig
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_SETTINGS: Settings = {
  defaultAgent: null,
  defaultModel: null,
  theme: "system",
}

const DEFAULT_LOCAL_STATE: LocalState = {
  currentChatId: null,
  previewStates: {},
  queuedMessages: {},
  queuePaused: {},
  drafts: {},
}

// =============================================================================
// Local State (Device-Specific)
// =============================================================================

export function loadLocalState(): LocalState {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_STATE
  }

  try {
    const stored = localStorage.getItem(LOCAL_STATE_KEY)
    if (!stored) {
      return DEFAULT_LOCAL_STATE
    }
    const parsed = JSON.parse(stored) as LocalState
    return {
      ...DEFAULT_LOCAL_STATE,
      ...parsed,
    }
  } catch (error) {
    console.error("Failed to load local state:", error)
    return DEFAULT_LOCAL_STATE
  }
}

export function saveLocalState(state: LocalState): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error("Failed to save local state:", error)
  }
}

export function setCurrentChatId(chatId: string | null): void {
  const state = loadLocalState()
  saveLocalState({ ...state, currentChatId: chatId })
}

export function setPreviewState(chatId: string, previewState: PreviewState | undefined): void {
  const state = loadLocalState()
  const newPreviewStates = { ...state.previewStates }
  if (previewState === undefined) {
    delete newPreviewStates[chatId]
  } else {
    newPreviewStates[chatId] = previewState
  }
  saveLocalState({
    ...state,
    previewStates: newPreviewStates,
  })
}

export function getPreviewState(chatId: string): PreviewState | undefined {
  const state = loadLocalState()
  return state.previewStates[chatId]
}

export function setQueuedMessages(chatId: string, messages: Chat["queuedMessages"]): void {
  const state = loadLocalState()
  saveLocalState({
    ...state,
    queuedMessages: { ...state.queuedMessages, [chatId]: messages },
  })
}

export function setQueuePaused(chatId: string, paused: boolean): void {
  const state = loadLocalState()
  saveLocalState({
    ...state,
    queuePaused: { ...state.queuePaused, [chatId]: paused },
  })
}

export function setDraft(chatId: string, draft: string | undefined): void {
  const state = loadLocalState()
  const newDrafts = { ...state.drafts }
  if (draft === undefined || draft === "") {
    delete newDrafts[chatId]
  } else {
    newDrafts[chatId] = draft
  }
  saveLocalState({
    ...state,
    drafts: newDrafts,
  })
}

export function setDraftChatConfig(config: DraftChatConfig | undefined): void {
  const state = loadLocalState()
  if (config === undefined) {
    const { draftChatConfig: _, ...rest } = state
    saveLocalState(rest as LocalState)
  } else {
    saveLocalState({ ...state, draftChatConfig: config })
  }
}

export function getDraftChatConfig(): DraftChatConfig | undefined {
  const state = loadLocalState()
  return state.draftChatConfig
}

export function clearDraftChatConfig(): void {
  setDraftChatConfig(undefined)
}

/**
 * Migrate local state from a draft chat ID to a real chat ID
 * Used when materializing a draft into a real database chat
 */
export function migrateDraftToRealChat(draftId: string, realId: string): void {
  const state = loadLocalState()
  const newPreviewStates = { ...state.previewStates }
  const newQueuedMessages = { ...state.queuedMessages }
  const newQueuePaused = { ...state.queuePaused }
  const newDrafts = { ...state.drafts }

  // Migrate any state from draft ID to real ID
  if (newPreviewStates[draftId]) {
    newPreviewStates[realId] = newPreviewStates[draftId]
    delete newPreviewStates[draftId]
  }
  if (newQueuedMessages[draftId]) {
    newQueuedMessages[realId] = newQueuedMessages[draftId]
    delete newQueuedMessages[draftId]
  }
  if (newQueuePaused[draftId] !== undefined) {
    newQueuePaused[realId] = newQueuePaused[draftId]
    delete newQueuePaused[draftId]
  }
  if (newDrafts[draftId]) {
    newDrafts[realId] = newDrafts[draftId]
    delete newDrafts[draftId]
  }

  saveLocalState({
    ...state,
    currentChatId: realId,
    previewStates: newPreviewStates,
    queuedMessages: newQueuedMessages,
    queuePaused: newQueuePaused,
    drafts: newDrafts,
    draftChatConfig: undefined, // Clear the draft config
  })
}

export function clearLocalStateForChats(chatIds: string[]): void {
  const localState = loadLocalState()
  const newPreviewStates = { ...localState.previewStates }
  const newQueuedMessages = { ...localState.queuedMessages }
  const newQueuePaused = { ...localState.queuePaused }
  const newDrafts = { ...localState.drafts }

  for (const id of chatIds) {
    delete newPreviewStates[id]
    delete newQueuedMessages[id]
    delete newQueuePaused[id]
    delete newDrafts[id]
  }

  saveLocalState({
    ...localState,
    previewStates: newPreviewStates,
    queuedMessages: newQueuedMessages,
    queuePaused: newQueuePaused,
    drafts: newDrafts,
    currentChatId: chatIds.includes(localState.currentChatId ?? "")
      ? null
      : localState.currentChatId,
  })
}

// =============================================================================
// Unseen Chat IDs (Device-Specific)
// =============================================================================

export function loadUnseenChatIds(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = localStorage.getItem(UNSEEN_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored) as string[]
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

export function saveUnseenChatIds(ids: Set<string>): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(UNSEEN_KEY, JSON.stringify([...ids]))
  } catch (error) {
    console.error("Failed to save unseen chat ids:", error)
  }
}

// =============================================================================
// Utilities
// =============================================================================

export function clearAllStorage(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(LOCAL_STATE_KEY)
    localStorage.removeItem(UNSEEN_KEY)
    // Also clear legacy server cache key if it exists
    localStorage.removeItem("simple-chat-cache")
  } catch (error) {
    console.error("Failed to clear storage:", error)
  }
}

export function collectDescendantIds(chats: Chat[], rootId: string): string[] {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const chat of chats) {
      if (chat.parentChatId && ids.has(chat.parentChatId) && !ids.has(chat.id)) {
        ids.add(chat.id)
        changed = true
      }
    }
  }
  return Array.from(ids)
}
