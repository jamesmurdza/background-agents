/**
 * Server Sync API
 *
 * All client-side API calls for server communication.
 * The server is the single source of truth - these functions
 * handle communication with the server.
 */

import type { Chat, Message, Settings, CustomEndpoint } from "@/lib/types"
import type { Credentials, CredentialFlags } from "@/lib/credentials"
// Type-only, same reasoning as lib/types.ts's own import of this.
import type { ScriptUpdateNotice } from "@/lib/setup-script"

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
  planModeEnabled: boolean
  environmentId?: string | null
  displayName: string | null
  shareId?: string | null
  status: string
  archived?: boolean
  pinned?: boolean
  parentChatId: string | null
  needsSync: boolean
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  messageCount?: number
  lastMessageId?: string | null
  scriptUpdateNotice?: ScriptUpdateNotice | null
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
  metadata: unknown
  agent: string | null
  model: string | null
  inherited?: boolean
}

export interface ChatWithMessagesResponse extends ChatResponse {
  messages: MessageResponse[]
  messageCount: number
}

export interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
  customEndpoints?: CustomEndpoint[]
  planIsPro?: boolean
  /**
   * Purchased credits in USD, or null when the balance doesn't gate this user.
   * Optional so an older deployment's response still parses; a missing value
   * reads the same as null (no tier, no warning) through creditTier.
   */
  creditBalanceUsd?: number | null
}

// =============================================================================
// API Helpers
// =============================================================================

// API base URL - configurable for Electron app pointing to hosted backend
const API_BASE_URL = typeof window !== "undefined"
  ? (window as { BACKGROUND_AGENTS_API_URL?: string }).BACKGROUND_AGENTS_API_URL || ""
  : process.env.NEXT_PUBLIC_API_URL || ""

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${path}`

  // Get auth token from Electron if available
  const authToken = typeof window !== "undefined" && (window as { electron?: { getAuthToken?: () => Promise<string | null> } }).electron?.getAuthToken
    ? await (window as { electron: { getAuthToken: () => Promise<string | null> } }).electron.getAuthToken()
    : null

  const response = await fetch(url, {
    ...options,
    credentials: "include", // Include cookies for same-origin, or auth header for cross-origin
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
  options?: {
    afterMessageId?: string
  }
): Promise<ChatWithMessagesResponse> {
  const params = new URLSearchParams()
  if (options?.afterMessageId) params.set("afterMessageId", options.afterMessageId)
  const query = params.toString()
  return fetchApi<ChatWithMessagesResponse>(`/api/chats/${chatId}${query ? `?${query}` : ""}`)
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
  planModeEnabled?: boolean
  environmentId?: string
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
    archived: boolean
    pinned: boolean
    agent: string
    model: string
    planModeEnabled: boolean
    repo: string
    baseBranch: string
    branch: string | null
    needsSync: boolean
    lastActiveAt: number
    environmentId: string
    // sandboxId / sessionId / previewUrlPattern / backgroundSessionId are
    // server-managed and rejected by PATCH /api/chats/[chatId] — never send them.
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
 * Fetch the public shared-pool flags (no auth). Used for logged-out visitors so
 * the agent picker can show shared-pool "ready" dots before sign-in.
 */
export async function fetchSharedPoolFlags(): Promise<{ credentialFlags: CredentialFlags }> {
  return fetchApi<{ credentialFlags: CredentialFlags }>("/api/shared-pool")
}

/**
 * Update user settings
 */
export async function updateSettings(data: {
  settings?: Partial<Settings>
  credentials?: Credentials
  customEndpoints?: CustomEndpoint[]
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
    planModeEnabled: serverChat.planModeEnabled,
    environmentId: serverChat.environmentId ?? null,
    displayName: serverChat.displayName,
    shareId: serverChat.shareId ?? null,
    status: serverChat.status as Chat["status"],
    archived: serverChat.archived ?? false,
    pinned: serverChat.pinned ?? false,
    parentChatId: serverChat.parentChatId || undefined,
    needsSync: serverChat.needsSync,
    createdAt: serverChat.createdAt,
    updatedAt: serverChat.updatedAt,
    lastActiveAt: serverChat.lastActiveAt,
    messages: [], // Messages loaded separately
    messageCount: serverChat.messageCount ?? 0, // For filtering before messages are loaded
    scriptUpdateNotice: serverChat.scriptUpdateNotice ?? null,
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
    agent: serverMessage.agent || undefined,
    model: serverMessage.model || undefined,
    messageType: serverMessage.messageType as Message["messageType"],
    isError: serverMessage.isError,
    toolCalls: serverMessage.toolCalls as Message["toolCalls"],
    contentBlocks: serverMessage.contentBlocks as Message["contentBlocks"],
    uploadedFiles: serverMessage.uploadedFiles as Message["uploadedFiles"],
    linkBranch: serverMessage.linkBranch || undefined,
    metadata: serverMessage.metadata as Message["metadata"],
    inherited: serverMessage.inherited || undefined,
  }
}

