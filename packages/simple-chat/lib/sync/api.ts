/**
 * Server Sync API
 *
 * All client-side API calls for server communication.
 * The server is the single source of truth - these functions
 * handle communication with the server.
 */

import type { Chat, Message, Settings } from "@/lib/types"
import type { Credentials, CredentialFlags } from "@/lib/credentials"

// =============================================================================
// Types
// =============================================================================

export interface ChatResponse {
  id: string
  repo: string
  baseBranch: string
  branch: string | null
  sandboxId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string | null
  agent: string
  model: string | null
  displayName: string | null
  status: string
  parentChatId: string | null
  needsSync: boolean
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  messageCount?: number
  lastMessageId?: string | null
}

export interface MessageResponse {
  id: string
  role: string
  content: string
  timestamp: number
  messageType: string | null
  isError: boolean
  toolCalls: unknown
  contentBlocks: unknown
  uploadedFiles: unknown
  linkBranch: string | null
}

export interface ChatWithMessagesResponse extends ChatResponse {
  messages: MessageResponse[]
}

export interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
}

// =============================================================================
// API Helpers
// =============================================================================

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

// =============================================================================
// Chats API
// =============================================================================

/**
 * Fetch all chats for the current user
 */
export async function fetchChats(): Promise<ChatResponse[]> {
  const result = await fetchApi<{ chats: ChatResponse[] }>("/api/chats")
  return result.chats
}

/**
 * Fetch a single chat with its messages
 */
export async function fetchChat(
  chatId: string,
  afterMessageId?: string
): Promise<ChatWithMessagesResponse> {
  const params = afterMessageId ? `?afterMessageId=${afterMessageId}` : ""
  return fetchApi<ChatWithMessagesResponse>(`/api/chats/${chatId}${params}`)
}

/**
 * Fetch messages for a chat (delta sync)
 */
export async function fetchMessages(
  chatId: string,
  afterMessageId?: string
): Promise<MessageResponse[]> {
  const chat = await fetchChat(chatId, afterMessageId)
  return chat.messages
}

/**
 * Create a new chat
 */
export async function createChat(data: {
  repo: string
  baseBranch?: string
  parentChatId?: string
  agent?: string
  model?: string
  status?: string
}): Promise<ChatResponse> {
  return fetchApi<ChatResponse>("/api/chats", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

/**
 * Update a chat
 */
export async function updateChat(
  chatId: string,
  data: Partial<{
    displayName: string
    status: string
    agent: string
    model: string
    repo: string
    baseBranch: string
    branch: string
    sandboxId: string
    sessionId: string
    previewUrlPattern: string
    backgroundSessionId: string | null
    needsSync: boolean
    lastActiveAt: number
  }>
): Promise<ChatResponse> {
  return fetchApi<ChatResponse>(`/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

/**
 * Delete a chat and all descendants
 */
export async function deleteChat(chatId: string): Promise<{
  deletedChatIds: string[]
  sandboxIdsToCleanup: string[]
}> {
  return fetchApi(`/api/chats/${chatId}`, {
    method: "DELETE",
  })
}

// =============================================================================
// Settings API
// =============================================================================

/**
 * Fetch user settings and credential flags
 */
export async function fetchSettings(): Promise<SettingsResponse> {
  return fetchApi<SettingsResponse>("/api/user/settings")
}

/**
 * Update user settings
 */
export async function updateSettings(data: {
  settings?: Partial<Settings>
  credentials?: Credentials
}): Promise<SettingsResponse> {
  return fetchApi<SettingsResponse>("/api/user/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

// =============================================================================
// Type Conversion Helpers
// =============================================================================

/**
 * Convert server ChatResponse to client Chat type
 */
export function toChatType(serverChat: ChatResponse): Chat {
  return {
    id: serverChat.id,
    repo: serverChat.repo,
    baseBranch: serverChat.baseBranch,
    branch: serverChat.branch,
    sandboxId: serverChat.sandboxId,
    sessionId: serverChat.sessionId,
    previewUrlPattern: serverChat.previewUrlPattern || undefined,
    backgroundSessionId: serverChat.backgroundSessionId || undefined,
    agent: serverChat.agent,
    model: serverChat.model || undefined,
    displayName: serverChat.displayName,
    status: serverChat.status as Chat["status"],
    parentChatId: serverChat.parentChatId || undefined,
    needsSync: serverChat.needsSync,
    createdAt: serverChat.createdAt,
    updatedAt: serverChat.updatedAt,
    lastActiveAt: serverChat.lastActiveAt,
    messages: [], // Messages loaded separately
    messageCount: serverChat.messageCount ?? 0, // For filtering before messages are loaded
  }
}

/**
 * Convert server MessageResponse to client Message type
 */
export function toMessageType(serverMessage: MessageResponse): Message {
  return {
    id: serverMessage.id,
    role: serverMessage.role as Message["role"],
    content: serverMessage.content,
    timestamp: serverMessage.timestamp,
    messageType: serverMessage.messageType as Message["messageType"],
    isError: serverMessage.isError,
    toolCalls: serverMessage.toolCalls as Message["toolCalls"],
    contentBlocks: serverMessage.contentBlocks as Message["contentBlocks"],
    uploadedFiles: serverMessage.uploadedFiles as Message["uploadedFiles"],
    linkBranch: serverMessage.linkBranch || undefined,
  }
}

