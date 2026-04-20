/**
 * LocalStorage utilities for Simple Chat
 * All app state is stored in localStorage - no database needed
 */

import type { AppState, Chat, Settings, Message } from "./types"
import type { UserCredentialFlags } from "@upstream/common"

const STORAGE_KEY = "simple-chat-state"
const UNSEEN_KEY = "simple-chat-unseen-completions"

const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  anthropicAuthToken: "",
  openaiApiKey: "",
  opencodeApiKey: "",
  geminiApiKey: "",
  defaultAgent: "opencode", // Default to opencode (has free models)
  defaultModel: "opencode/big-pickle", // Free model
  theme: "system",
}

const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: DEFAULT_SETTINGS,
}

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

/**
 * Load app state from localStorage
 */
export function loadState(): AppState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return DEFAULT_STATE
    }
    const parsed = JSON.parse(stored) as AppState
    // Merge with defaults to handle schema upgrades
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
 * Save app state to localStorage.
 */
export function saveState(state: AppState): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error("Failed to save state to localStorage:", error)
  }
}

/**
 * Drop unstarted chats (no messages) from the loaded state on hydration so
 * they don't survive reloads. We do this on load rather than save so that
 * in-memory storage helpers (which loadState → mutate → saveState) still
 * find the active draft chat.
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

/**
 * Update settings
 */
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

/**
 * Create a new chat
 * @param chat - The chat to create
 * @param switchTo - Whether to switch to the new chat (default: true)
 */
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

/**
 * Update an existing chat
 */
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

/**
 * Delete a chat and every descendant (children, grandchildren, …) that was
 * branched from it. Returns the full list of removed chat ids.
 */
export function deleteChat(chatId: string): { state: AppState; removedIds: string[] } {
  const state = loadState()
  // Collect ids to remove via BFS on parentChatId edges.
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

/** Collect the id of a chat plus all of its descendants. */
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

/**
 * Set current chat
 */
export function setCurrentChat(chatId: string | null): AppState {
  const state = loadState()
  const newState = {
    ...state,
    currentChatId: chatId,
  }
  saveState(newState)
  return newState
}

/**
 * Add a message to a chat
 */
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

/**
 * Update the last message in a chat (for streaming responses)
 */
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

/**
 * Update a specific message by ID
 */
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

/**
 * Get a specific chat
 */
export function getChat(chatId: string): Chat | undefined {
  const state = loadState()
  return state.chats.find((chat) => chat.id === chatId)
}

/**
 * Get current chat
 */
export function getCurrentChat(): Chat | undefined {
  const state = loadState()
  if (!state.currentChatId) return undefined
  return state.chats.find((chat) => chat.id === state.currentChatId)
}
