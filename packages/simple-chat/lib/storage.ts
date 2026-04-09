/**
 * LocalStorage utilities for Simple Chat
 * All app state is stored in localStorage - no database needed
 */

import type { AppState, Chat, Settings, Message } from "./types"

const STORAGE_KEY = "simple-chat-state"

const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: {
    anthropicApiKey: "",
    theme: "system",
  },
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
 * Save app state to localStorage
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
 */
export function createChat(chat: Chat): AppState {
  const state = loadState()
  const newState = {
    ...state,
    chats: [chat, ...state.chats],
    currentChatId: chat.id,
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
 * Delete a chat
 */
export function deleteChat(chatId: string): AppState {
  const state = loadState()
  const newChats = state.chats.filter((chat) => chat.id !== chatId)
  const newState = {
    ...state,
    chats: newChats,
    currentChatId:
      state.currentChatId === chatId
        ? newChats[0]?.id ?? null
        : state.currentChatId,
  }
  saveState(newState)
  return newState
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
