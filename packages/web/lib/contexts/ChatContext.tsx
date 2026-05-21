"use client"

import { createContext, useContext, ReactNode } from "react"
import type { Chat, Settings, Agent, Message, CredentialFlags, ChatStatus } from "@/lib/types"

// =============================================================================
// ChatContext - Provides shared chat state to avoid prop drilling
// =============================================================================

export interface ChatContextValue {
  // Current state
  currentChat: Chat | null
  currentChatId: string | null
  chats: Chat[]
  settings: Settings
  credentialFlags: CredentialFlags
  isHydrated: boolean
  isLoadingMessages: boolean
  isSending: boolean

  // Chat operations
  selectChat: (chatId: string) => void
  startNewChat: (repo?: string, baseBranch?: string, parentChatId?: string, switchTo?: boolean, initialStatus?: ChatStatus, agent?: string | null, model?: string | null) => Promise<string | null>
  removeChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, name: string) => Promise<void>
  updateCurrentChat: (updates: Partial<Chat>) => void
  updateChatById: (chatId: string, updates: Partial<Chat>) => Promise<void>

  // Message operations
  sendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  stopAgent: () => void
  addMessage: (message: Message) => void

  // Queue operations
  enqueueMessage: (message: string, agent?: string, model?: string) => void
  removeQueuedMessage: (id: string) => void
  resumeQueue: () => void

  // Draft operations
  drafts: Record<string, string>
  updateDraft: (chatId: string, draft: string) => void
  clearDraft: (chatId: string) => void
  isDraftChatId: (chatId: string) => boolean
  draftChatConfig: { id: string; repo: string; baseBranch: string; agent: string | null; model: string | null; planMode?: boolean } | null | undefined
  updateDraftChatConfig: (updates: Partial<{ repo: string; baseBranch: string; agent: string | null; model: string | null; planMode?: boolean }>) => void

  // Message operations
  refetchMessages: (chatId: string) => Promise<void>

  // Tracking
  deletingChatIds: Set<string>
  unseenChatIds: Set<string>

  // Repo operations
  updateChatRepo: (chatId: string, repo: string, branch: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children, value }: { children: ReactNode; value: ChatContextValue }) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider")
  }
  return context
}

/** Optional hook that returns null if not in provider (for conditional usage) */
export function useChatOptional(): ChatContextValue | null {
  return useContext(ChatContext)
}
