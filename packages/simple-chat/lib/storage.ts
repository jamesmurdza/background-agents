/**
 * LocalStorage utilities for Simple Chat
 *
 * With server sync enabled:
 * - Device-specific state (currentChatId, unseenChatIds, previewItems) stays in localStorage
 * - Server cache (chats, messages, settings) is stored in localStorage as a read-only mirror
 * - All writes go through the server first, then update local cache
 */

import type { AppState, Chat, Settings, Message } from "./types"
import type { UserCredentialFlags } from "@upstream/common"

// =============================================================================
// Storage Keys
// =============================================================================

// Legacy key (for migration)
const LEGACY_STORAGE_KEY = "simple-chat-state"

// New keys for split storage
const LOCAL_STATE_KEY = "simple-chat-local"
const SERVER_CACHE_KEY = "simple-chat-cache"
const UNSEEN_KEY = "simple-chat-unseen-completions"

// =============================================================================
// Types
// =============================================================================

/**
 * Device-specific state that stays in localStorage (NOT synced to server)
 */
export interface LocalState {
  currentChatId: string | null
  // Per-chat preview items (what's open in preview pane)
  previewItems: Record<string, Chat["previewItem"]>
  // Per-chat queued messages (device-specific)
  queuedMessages: Record<string, Chat["queuedMessages"]>
  queuePaused: Record<string, boolean>
}

/**
 * Server cache - read-only mirror of server data
 */
export interface ServerCache {
  chats: Chat[]
  settings: Settings
  lastSyncAt: number
  // Track last message ID per chat for delta sync
  lastMessageIds: Record<string, string>
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  anthropicAuthToken: "",
  openaiApiKey: "",
  opencodeApiKey: "",
  geminiApiKey: "",
  defaultAgent: "opencode",
  defaultModel: "opencode/big-pickle",
  theme: "system",
}

const DEFAULT_LOCAL_STATE: LocalState = {
  currentChatId: null,
  previewItems: {},
  queuedMessages: {},
  queuePaused: {},
}

const DEFAULT_SERVER_CACHE: ServerCache = {
  chats: [],
  settings: DEFAULT_SETTINGS,
  lastSyncAt: 0,
  lastMessageIds: {},
}

const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: DEFAULT_SETTINGS,
}

// =============================================================================
// Credential Flags
// =============================================================================

/**
 * Get user credential flags based on settings
 */
export function getCredentialFlags(settings: Settings): UserCredentialFlags {
  return {
    hasAnthropicApiKey: !!settings.anthropicApiKey,
    hasAnthropicAuthToken: !!settings.anthropicAuthToken,
    hasOpenaiApiKey: !!settings.openaiApiKey,
    hasOpencodeApiKey: !!settings.opencodeApiKey,
    hasGeminiApiKey: !!settings.geminiApiKey,
  }
}

// =============================================================================
// Local State (Device-Specific)
// =============================================================================

/**
 * Load device-specific local state
 */
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

/**
 * Save device-specific local state
 */
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
 * Update current chat ID
 */
export function setCurrentChatId(chatId: string | null): void {
  const state = loadLocalState()
  saveLocalState({ ...state, currentChatId: chatId })
}

/**
 * Set preview item for a chat
 */
export function setPreviewItem(chatId: string, item: Chat["previewItem"]): void {
  const state = loadLocalState()
  saveLocalState({
    ...state,
    previewItems: { ...state.previewItems, [chatId]: item },
  })
}

/**
 * Get preview item for a chat
 */
export function getPreviewItem(chatId: string): Chat["previewItem"] {
  const state = loadLocalState()
  return state.previewItems[chatId]
}

/**
 * Set queued messages for a chat
 */
export function setQueuedMessages(chatId: string, messages: Chat["queuedMessages"]): void {
  const state = loadLocalState()
  saveLocalState({
    ...state,
    queuedMessages: { ...state.queuedMessages, [chatId]: messages },
  })
}

/**
 * Get queued messages for a chat
 */
export function getQueuedMessages(chatId: string): Chat["queuedMessages"] {
  const state = loadLocalState()
  return state.queuedMessages[chatId]
}

/**
 * Set queue paused for a chat
 */
export function setQueuePaused(chatId: string, paused: boolean): void {
  const state = loadLocalState()
  saveLocalState({
    ...state,
    queuePaused: { ...state.queuePaused, [chatId]: paused },
  })
}

/**
 * Get queue paused for a chat
 */
export function getQueuePaused(chatId: string): boolean {
  const state = loadLocalState()
  return state.queuePaused[chatId] ?? false
}

// =============================================================================
// Server Cache (Read-Only Mirror)
// =============================================================================

/**
 * Load server cache
 */
export function loadServerCache(): ServerCache {
  if (typeof window === "undefined") {
    return DEFAULT_SERVER_CACHE
  }

  try {
    const stored = localStorage.getItem(SERVER_CACHE_KEY)
    if (!stored) {
      return DEFAULT_SERVER_CACHE
    }
    const parsed = JSON.parse(stored) as ServerCache
    return {
      ...DEFAULT_SERVER_CACHE,
      ...parsed,
      settings: {
        ...DEFAULT_SERVER_CACHE.settings,
        ...parsed.settings,
      },
    }
  } catch (error) {
    console.error("Failed to load server cache:", error)
    return DEFAULT_SERVER_CACHE
  }
}

/**
 * Save server cache
 */
export function saveServerCache(cache: ServerCache): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    localStorage.setItem(SERVER_CACHE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.error("Failed to save server cache:", error)
  }
}

/**
 * Update chats in cache
 */
export function updateCacheChats(chats: Chat[]): void {
  const cache = loadServerCache()
  saveServerCache({
    ...cache,
    chats,
    lastSyncAt: Date.now(),
  })
}

/**
 * Update a single chat in cache
 */
export function updateCacheChat(chatId: string, updates: Partial<Chat>): void {
  const cache = loadServerCache()
  saveServerCache({
    ...cache,
    chats: cache.chats.map((chat) =>
      chat.id === chatId ? { ...chat, ...updates } : chat
    ),
  })
}

/**
 * Add a chat to cache
 */
export function addCacheChat(chat: Chat): void {
  const cache = loadServerCache()
  saveServerCache({
    ...cache,
    chats: [chat, ...cache.chats],
  })
}

/**
 * Remove chats from cache
 */
export function removeCacheChats(chatIds: string[]): void {
  const cache = loadServerCache()
  const idsSet = new Set(chatIds)
  saveServerCache({
    ...cache,
    chats: cache.chats.filter((chat) => !idsSet.has(chat.id)),
  })

  // Also clean up local state for these chats
  const localState = loadLocalState()
  const newPreviewItems = { ...localState.previewItems }
  const newQueuedMessages = { ...localState.queuedMessages }
  const newQueuePaused = { ...localState.queuePaused }
  for (const id of chatIds) {
    delete newPreviewItems[id]
    delete newQueuedMessages[id]
    delete newQueuePaused[id]
  }
  saveLocalState({
    ...localState,
    previewItems: newPreviewItems,
    queuedMessages: newQueuedMessages,
    queuePaused: newQueuePaused,
    currentChatId: chatIds.includes(localState.currentChatId ?? "")
      ? null
      : localState.currentChatId,
  })
}

/**
 * Update messages for a chat in cache, deduping by ID
 */
export function updateCacheMessages(chatId: string, newMessages: Message[]): void {
  const cache = loadServerCache()
  const chat = cache.chats.find((c) => c.id === chatId)
  if (!chat) return

  // Dedupe by ID
  const existingIds = new Set(chat.messages.map((m) => m.id))
  const dedupedNew = newMessages.filter((m) => !existingIds.has(m.id))

  if (dedupedNew.length === 0) return

  const updatedMessages = [...chat.messages, ...dedupedNew]
  const lastMessageId = updatedMessages[updatedMessages.length - 1]?.id

  saveServerCache({
    ...cache,
    chats: cache.chats.map((c) =>
      c.id === chatId ? { ...c, messages: updatedMessages } : c
    ),
    lastMessageIds: {
      ...cache.lastMessageIds,
      [chatId]: lastMessageId,
    },
  })
}

/**
 * Update the last message for a chat (for streaming)
 */
export function updateCacheLastMessage(chatId: string, updates: Partial<Message>): void {
  const cache = loadServerCache()
  saveServerCache({
    ...cache,
    chats: cache.chats.map((chat) => {
      if (chat.id !== chatId) return chat
      const messages = [...chat.messages]
      const lastIndex = messages.length - 1
      if (lastIndex >= 0) {
        messages[lastIndex] = { ...messages[lastIndex], ...updates }
      }
      return { ...chat, messages }
    }),
  })
}

/**
 * Update settings in cache
 */
export function updateCacheSettings(settings: Settings): void {
  const cache = loadServerCache()
  saveServerCache({
    ...cache,
    settings,
  })
}

/**
 * Get last message ID for a chat
 */
export function getLastMessageId(chatId: string): string | undefined {
  const cache = loadServerCache()
  return cache.lastMessageIds[chatId]
}

// =============================================================================
// Unseen Chat IDs (Device-Specific)
// =============================================================================

/**
 * Load the set of chat IDs with unseen completions
 */
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

/**
 * Save the set of chat IDs with unseen completions
 */
export function saveUnseenChatIds(ids: Set<string>): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(UNSEEN_KEY, JSON.stringify([...ids]))
  } catch (error) {
    console.error("Failed to save unseen chat ids:", error)
  }
}

// =============================================================================
// Legacy Support (for migration and backward compatibility)
// =============================================================================

/**
 * Load app state from localStorage (legacy format)
 * Used for backward compatibility during migration
 */
export function loadState(): AppState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE
  }

  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!stored) {
      // Try loading from new format
      const cache = loadServerCache()
      const local = loadLocalState()
      return {
        currentChatId: local.currentChatId,
        chats: cache.chats.map((chat) => ({
          ...chat,
          previewItem: local.previewItems[chat.id],
          queuedMessages: local.queuedMessages[chat.id],
          queuePaused: local.queuePaused[chat.id],
        })),
        settings: cache.settings,
      }
    }
    const parsed = JSON.parse(stored) as AppState
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: {
        ...DEFAULT_STATE.settings,
        ...parsed.settings,
      },
    }
  } catch (error) {
    console.error("Failed to load state from localStorage:", error)
    return DEFAULT_STATE
  }
}

/**
 * Save app state to localStorage (legacy format)
 */
export function saveState(state: AppState): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error("Failed to save state to localStorage:", error)
  }
}

/**
 * Check if legacy data exists and needs migration
 */
export function hasLegacyData(): boolean {
  if (typeof window === "undefined") return false
  return !!localStorage.getItem(LEGACY_STORAGE_KEY)
}

/**
 * Clear legacy data after migration
 */
export function clearLegacyData(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

/**
 * Drop unstarted chats (no messages) from the loaded state on hydration
 */
export function loadAndPruneEmptyChats(): AppState {
  const state = loadState()
  const nonEmptyChats = state.chats.filter((c) => c.messages.length > 0)
  const currentStillExists =
    !!state.currentChatId && nonEmptyChats.some((c) => c.id === state.currentChatId)
  return {
    ...state,
    chats: nonEmptyChats,
    currentChatId: currentStillExists ? state.currentChatId : null,
  }
}

// =============================================================================
// Legacy Functions (kept for backward compatibility during transition)
// =============================================================================

export function updateSettings(settings: Partial<Settings>): AppState {
  const state = loadState()
  const newState = {
    ...state,
    settings: {
      ...state.settings,
      ...settings,
    },
  }
  saveState(newState)
  return newState
}

export function createChat(chat: Chat, switchTo: boolean = true): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: [chat, ...state.chats],
    currentChatId: switchTo ? chat.id : state.currentChatId,
  }
  saveState(newState)
  return newState
}

export function updateChat(chatId: string, updates: Partial<Chat>): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: state.chats.map((chat) =>
      chat.id === chatId
        ? { ...chat, ...updates, updatedAt: Date.now() }
        : chat
    ),
  }
  saveState(newState)
  return newState
}

export function deleteChat(chatId: string): { state: AppState; removedIds: string[] } {
  const state = loadState()
  const toRemove = new Set<string>([chatId])
  let changed = true
  while (changed) {
    changed = false
    for (const chat of state.chats) {
      if (chat.parentChatId && toRemove.has(chat.parentChatId) && !toRemove.has(chat.id)) {
        toRemove.add(chat.id)
        changed = true
      }
    }
  }
  const newChats = state.chats.filter((chat) => !toRemove.has(chat.id))
  const newState: AppState = {
    ...state,
    chats: newChats,
    currentChatId:
      state.currentChatId && toRemove.has(state.currentChatId)
        ? newChats[0]?.id ?? null
        : state.currentChatId,
  }
  saveState(newState)
  return { state: newState, removedIds: Array.from(toRemove) }
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

export function setCurrentChat(chatId: string | null): AppState {
  const state = loadState()
  const newState = {
    ...state,
    currentChatId: chatId,
  }
  saveState(newState)
  return newState
}

export function addMessage(chatId: string, message: Message): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: state.chats.map((chat) =>
      chat.id === chatId
        ? {
            ...chat,
            messages: [...chat.messages, message],
            updatedAt: Date.now(),
          }
        : chat
    ),
  }
  saveState(newState)
  return newState
}

export function updateLastMessage(
  chatId: string,
  updates: Partial<Message>
): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: state.chats.map((chat) => {
      if (chat.id !== chatId) return chat
      const messages = [...chat.messages]
      const lastIndex = messages.length - 1
      if (lastIndex >= 0) {
        messages[lastIndex] = { ...messages[lastIndex], ...updates }
      }
      return { ...chat, messages, updatedAt: Date.now() }
    }),
  }
  saveState(newState)
  return newState
}

export function updateMessage(
  chatId: string,
  messageId: string,
  updates: Partial<Message>
): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: state.chats.map((chat) => {
      if (chat.id !== chatId) return chat
      const messages = chat.messages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
      return { ...chat, messages, updatedAt: Date.now() }
    }),
  }
  saveState(newState)
  return newState
}

export function getChat(chatId: string): Chat | undefined {
  const state = loadState()
  return state.chats.find((chat) => chat.id === chatId)
}

export function getCurrentChat(): Chat | undefined {
  const state = loadState()
  if (!state.currentChatId) return undefined
  return state.chats.find((chat) => chat.id === state.currentChatId)
}
