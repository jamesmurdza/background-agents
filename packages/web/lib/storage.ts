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
  planMode?: boolean
}

/** Preview state for a chat */
export interface PreviewState {
  items: Chat["previewItems"]
  activeIndex: number
  hidden?: boolean
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
  rapidFireMode: false,
  enablePrepushHooks: false,
  notifyOnAgentFinished: true,
  notifyOnAgentCommitted: true,
  notificationSound: true,
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

/**
 * Load local state, apply a transformation, and save the result.
 * Centralizes the load → mutate → save pattern used by every setter below.
 */
function updateLocalState(updater: (state: LocalState) => LocalState): void {
  saveLocalState(updater(loadLocalState()))
}

/**
 * Update a single keyed entry inside one of the per-chat record fields.
 * Passing `undefined` removes the entry; otherwise it is set.
 */
function updateLocalStateRecord<K extends "previewStates" | "queuedMessages" | "queuePaused" | "drafts">(
  field: K,
  key: string,
  value: LocalState[K][string] | undefined,
  shouldDelete: (value: LocalState[K][string] | undefined) => boolean = (v) => v === undefined,
): void {
  updateLocalState((state) => {
    const next = { ...state[field] } as LocalState[K]
    if (shouldDelete(value)) {
      delete next[key]
    } else {
      next[key] = value as LocalState[K][string]
    }
    return { ...state, [field]: next }
  })
}

export function setCurrentChatId(chatId: string | null): void {
  updateLocalState((state) => ({ ...state, currentChatId: chatId }))
}

export function setPreviewState(chatId: string, previewState: PreviewState | undefined): void {
  updateLocalStateRecord("previewStates", chatId, previewState)
}

export function setQueuedMessages(chatId: string, messages: Chat["queuedMessages"]): void {
  updateLocalStateRecord("queuedMessages", chatId, messages, () => false)
}

export function setQueuePaused(chatId: string, paused: boolean): void {
  updateLocalStateRecord("queuePaused", chatId, paused, () => false)
}

export function setDraft(chatId: string, draft: string | undefined): void {
  updateLocalStateRecord("drafts", chatId, draft, (v) => v === undefined || v === "")
}

export function setDraftChatConfig(config: DraftChatConfig | undefined): void {
  updateLocalState((state) => {
    if (config === undefined) {
      const { draftChatConfig: _, ...rest } = state
      return rest as LocalState
    }
    return { ...state, draftChatConfig: config }
  })
}

export function clearDraftChatConfig(): void {
  setDraftChatConfig(undefined)
}

// Per-chat record fields that live inside LocalState
const CHAT_KEYED_FIELDS = ["previewStates", "queuedMessages", "queuePaused", "drafts"] as const

/**
 * Move a single keyed entry from one id to another inside a record, if present.
 * Returns the (possibly mutated) shallow copy.
 */
function renameKey<T>(record: Record<string, T>, fromId: string, toId: string): Record<string, T> {
  if (!(fromId in record)) return record
  const next = { ...record }
  next[toId] = next[fromId]
  delete next[fromId]
  return next
}

/**
 * Migrate local state from a draft chat ID to a real chat ID
 * Used when materializing a draft into a real database chat
 */
export function migrateDraftToRealChat(draftId: string, realId: string): void {
  updateLocalState((state) => {
    const next: LocalState = { ...state, currentChatId: realId, draftChatConfig: undefined }
    for (const field of CHAT_KEYED_FIELDS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next[field] = renameKey(state[field] as Record<string, any>, draftId, realId) as any
    }
    return next
  })
}

export function clearLocalStateForChats(chatIds: string[]): void {
  updateLocalState((state) => {
    const next: LocalState = {
      ...state,
      currentChatId: chatIds.includes(state.currentChatId ?? "") ? null : state.currentChatId,
    }
    for (const field of CHAT_KEYED_FIELDS) {
      const copy = { ...state[field] } as Record<string, unknown>
      for (const id of chatIds) delete copy[id]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next[field] = copy as any
    }
    return next
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
