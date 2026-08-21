import { getServerSession } from "next-auth"
import { Daytona } from "@daytonaio/sdk"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import {
  CREDENTIAL_KEYS,
  normalizeStoredCredentials,
  type Credentials,
} from "@/lib/credentials"
import { pickSharedOpencodeKey } from "@/lib/server/opencode-pool"

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
 * Returns a 403 Forbidden response. Used when the caller is authenticated but
 * does not own the resource they're addressing.
 */
export function forbidden(message: string = "Forbidden") {
  return Response.json({ error: message }, { status: 403 })
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
// Daytona Client Helper
// =============================================================================

/**
 * Resolves a Daytona client from the DAYTONA_API_KEY env var, or returns a 500
 * server-config-error Response when the key is missing. Mirrors the requireAuth
 * pattern so routes stop repeating the env-check + client-construction boilerplate:
 *
 *   const daytona = requireDaytona()
 *   if (daytona instanceof Response) return daytona
 *   // ...use daytona
 */
export function requireDaytona(): Daytona | Response {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return serverConfigError("DAYTONA_API_KEY")
  return new Daytona({ apiKey })
}

// =============================================================================
// Authentication Helpers
// =============================================================================

/**
 * Gets the authenticated user's ID from the session
 * Returns null if not authenticated
 */
async function getAuthUserId(): Promise<string | null> {
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
 * Requires admin authentication - returns userId or error Response
 * Usage: const auth = await requireAdmin()
 * If not authenticated or not admin, returns an unauthorized/forbidden Response
 */
export async function requireAdmin(): Promise<AuthResult | Response> {
  const userId = await getAuthUserId()
  if (!userId) {
    return unauthorized()
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  })

  if (!user?.isAdmin) {
    return Response.json(
      { error: "Forbidden: Admin access required" },
      { status: 403 }
    )
  }

  return { userId }
}

export interface ChatStreamAccessResult {
  userId: string
  chat: {
    id: string
    sandboxId: string | null
    backgroundSessionId: string | null
    previewUrlPattern: string | null
  }
}

/**
 * Auth gate for streaming routes. Verifies the caller is signed in, owns the
 * chat, and that the message lives in that chat. Returns the userId AND the
 * chat row (sandboxId / backgroundSessionId / previewUrlPattern) on success.
 *
 * Callers MUST use these fields from the returned chat rather than from any
 * client-supplied query params — that was the root of the pre-fix IDOR where
 * the stream route trusted url-supplied sandboxId/backgroundSessionId.
 */
export async function requireChatStreamAccess(
  chatId: string | null,
  assistantMessageId: string | null
): Promise<ChatStreamAccessResult | Response> {
  const userId = await getAuthUserId()
  if (!userId) return unauthorized()
  if (!chatId) return badRequest("chatId is required")

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  if (assistantMessageId) {
    const msg = await prisma.message.findFirst({
      where: { id: assistantMessageId, chatId },
      select: { id: true },
    })
    if (!msg) return notFound("Message not found")
  }

  return {
    userId,
    chat: {
      id: chat.id,
      sandboxId: chat.sandboxId,
      backgroundSessionId: chat.backgroundSessionId,
      previewUrlPattern: chat.previewUrlPattern,
    },
  }
}

/**
 * Verifies that `sandboxId` belongs to `userId`. A Daytona sandbox is owned by
 * the caller when either a chat they own or a scheduled-job run they own (via
 * its parent job) references it. Pure DB check — no session lookup — so routes
 * that already resolved the user (e.g. via requireGitHubAuth) can reuse it.
 */
export async function verifySandboxOwnership(
  userId: string,
  sandboxId: string
): Promise<boolean> {
  const [chat, run] = await Promise.all([
    prisma.chat.findFirst({
      where: { sandboxId, userId },
      select: { id: true },
    }),
    prisma.scheduledJobRun.findFirst({
      where: { sandboxId, job: { userId } },
      select: { id: true },
    }),
  ])
  return Boolean(chat || run)
}

/**
 * Auth + ownership gate for the /api/sandbox/* routes. Verifies the caller is
 * signed in and owns the sandbox they're addressing, closing the IDOR where any
 * caller with a sandboxId could read/delete/exec against another user's sandbox.
 *
 * Returns the userId on success, or an error Response (401 unauth / 403 not the
 * owner) that the route should return directly. The 403 deliberately does not
 * distinguish "not yours" from "does not exist" so sandbox ids aren't probeable.
 *
 * Usage:
 *   const owner = await requireSandboxOwner(sandboxId)
 *   if (owner instanceof Response) return owner
 */
export async function requireSandboxOwner(
  sandboxId: string
): Promise<AuthResult | Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  if (!(await verifySandboxOwnership(auth.userId, sandboxId))) {
    return forbidden()
  }
  return auth
}

// =============================================================================
// GitHub Token Helpers
// =============================================================================

export interface GitHubAuthResult {
  userId: string
  token: string
}

/**
 * Gets the GitHub access token for a user from the database.
 * Returns null if no GitHub account is linked or no token is stored.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { access_token: true },
  })
  return account?.access_token ?? null
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

  const creds = decryptUserCredentials(user?.credentials as Record<string, unknown> | null)

  // Fallback: if a credential isn't stored in the DB, check process.env.
  // This lets operators set API keys in .env / .env.local without the UI.
  // OpenCode's shared key comes from a pool (comma-separated OPENCODE_API_KEY) —
  // pick one at random per resolution so runs spread evenly across the keys.
  for (const { id } of CREDENTIAL_KEYS) {
    if (creds[id]) continue
    const envVal =
      id === "OPENCODE_API_KEY" ? pickSharedOpencodeKey() : process.env[id]
    if (envVal) creds[id] = envVal
  }

  return creds
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
  planModeEnabled: boolean
  displayName: string | null
  shareId: string | null
  status: string
  archived: boolean
  pinned: boolean
  parentChatId: string | null
  needsSync: boolean
  environmentVariables: unknown
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

