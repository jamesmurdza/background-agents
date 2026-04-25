import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import {
  CREDENTIAL_KEYS,
  normalizeStoredCredentials,
  type Credentials,
} from "@/lib/credentials"

// =============================================================================
// Types
// =============================================================================

export interface AuthResult {
  userId: string
}

// =============================================================================
// Error Response Helpers
// =============================================================================

/**
 * Returns a 401 Unauthorized response
 */
export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

/**
 * Returns a 400 Bad Request response
 */
export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

/**
 * Returns a 404 Not Found response
 */
export function notFound(message: string = "Not found") {
  return Response.json({ error: message }, { status: 404 })
}

/**
 * Returns a 500 Server Configuration Error response
 * Use when a required environment variable is missing
 */
export function serverConfigError(varName?: string) {
  const message = varName
    ? `Server configuration error: ${varName} not configured`
    : "Server configuration error"
  return Response.json({ error: message }, { status: 500 })
}

/**
 * Returns a 500 Internal Server Error response
 * Safely extracts error message from unknown error types
 */
export function internalError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  return Response.json({ error: message }, { status: 500 })
}

// =============================================================================
// Authentication Helpers
// =============================================================================

/**
 * Gets the authenticated user's ID from the session
 * Returns null if not authenticated
 */
export async function getAuthUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

/**
 * Requires authentication - returns userId or throws Response
 * Usage: const auth = await requireAuth()
 * If not authenticated, returns an unauthorized Response that should be returned from the route
 */
export async function requireAuth(): Promise<AuthResult | Response> {
  const userId = await getAuthUserId()
  if (!userId) {
    return unauthorized()
  }
  return { userId }
}

/**
 * Helper to check if requireAuth returned an error response
 */
export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response
}

/**
 * Auth gate for streaming routes that take chatId/assistantMessageId from
 * query parameters. Verifies the caller is signed in, owns the chat, and
 * that the message lives in that chat. Returns the userId on success, or a
 * Response the caller should return verbatim on failure.
 */
export async function requireChatStreamAccess(
  chatId: string | null,
  assistantMessageId: string | null
): Promise<AuthResult | Response> {
  const userId = await getAuthUserId()
  if (!userId) return unauthorized()

  if (chatId) {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    if (assistantMessageId) {
      const msg = await prisma.message.findFirst({
        where: { id: assistantMessageId, chatId },
        select: { id: true },
      })
      if (!msg) return notFound("Message not found")
    }
  }

  return { userId }
}

// =============================================================================
// GitHub Token Helpers
// =============================================================================

export interface GitHubAuthResult {
  userId: string
  token: string
}

/**
 * Gets the authenticated user's GitHub token
 * Returns userId and token or an error Response
 */
export async function requireGitHubAuth(): Promise<GitHubAuthResult | Response> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id ?? null

  if (!userId) {
    return unauthorized()
  }

  // Get the GitHub account access token
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { access_token: true },
  })

  if (!account?.access_token) {
    return Response.json({ error: "GitHub account not linked" }, { status: 401 })
  }

  return { userId, token: account.access_token }
}

/**
 * Helper to check if requireGitHubAuth returned an error response
 */
export function isGitHubAuthError(
  result: GitHubAuthResult | Response
): result is Response {
  return result instanceof Response
}

// =============================================================================
// Credential Helpers
// =============================================================================

/**
 * Decrypts a stored credentials JSON blob into the env-var-keyed Credentials
 * map. Accepts either the new env-var keys or legacy camelCase keys
 * (auto-migrated on next write by the settings route).
 */
export function decryptUserCredentials(
  raw: Record<string, unknown> | null | undefined
): Credentials {
  const stored = normalizeStoredCredentials(raw)
  const out: Credentials = {}
  for (const { id } of CREDENTIAL_KEYS) {
    const enc = stored[id]
    if (enc) {
      const dec = decrypt(enc)
      if (dec) out[id] = dec
    }
  }
  return out
}

/**
 * Gets decrypted credentials for a user, keyed by env var name.
 */
export async function getUserCredentials(userId: string): Promise<Credentials> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentials: true },
  })

  return decryptUserCredentials(user?.credentials as Record<string, unknown> | null)
}

// =============================================================================
// Database Query Helpers
// =============================================================================

/**
 * Fetches a chat by ID and verifies ownership
 * Returns null if not found or not owned by user
 */
export async function getChatWithAuth(
  chatId: string,
  userId: string
): Promise<{
  id: string
  userId: string
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
  createdAt: Date
  updatedAt: Date
  lastActiveAt: Date
} | null> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
  })

  if (!chat || chat.userId !== userId) {
    return null
  }

  return chat
}

/**
 * Fetches a chat with its messages
 * Returns null if not found or not owned by user
 */
export async function getChatWithMessagesAuth(
  chatId: string,
  userId: string,
  afterMessageId?: string
): Promise<{
  chat: NonNullable<Awaited<ReturnType<typeof getChatWithAuth>>>
  messages: Array<{
    id: string
    chatId: string
    role: string
    content: string
    timestamp: bigint
    messageType: string | null
    isError: boolean
    toolCalls: unknown
    contentBlocks: unknown
    uploadedFiles: unknown
    linkBranch: string | null
    createdAt: Date
  }>
} | null> {
  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return null

  const messages = await prisma.message.findMany({
    where: {
      chatId,
      ...(afterMessageId && {
        id: { gt: afterMessageId },
      }),
    },
    orderBy: { timestamp: "asc" },
  })

  return { chat, messages }
}
