/**
 * LocalStorage utilities for Simple Chat
 *
 * With server sync enabled:
 * - Device-specific state (currentChatId, unseenChatIds, previewItems) stays in localStorage
 * - Server cache (chats, messages, settings) is stored in localStorage as a read-only mirror
 * - All writes go through the server first, then update local cache
 */

import type { Chat, Settings, Message } from "./types"
import type { UserCredentialFlags } from "@upstream/common"

// =============================================================================
// Storage Keys
// =============================================================================

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
// Utilities
// =============================================================================

/**
 * Collect all descendant chat IDs for a root chat (for cascade delete)
 */
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
