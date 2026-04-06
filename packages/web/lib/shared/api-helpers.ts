import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/auth"
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/auth/encryption"
import { BRANCH_STATUS, type BranchStatus, type AnthropicAuthType } from "@/lib/shared/constants"
import {
  INCLUDE_SANDBOX_WITH_USER_CREDENTIALS,
  INCLUDE_BRANCH_WITH_REPO,
} from "@/lib/db/prisma-includes"
import {
  isAuthSkipped,
  ensureDevUserExists,
  warnAboutSkippedAuth,
  getDevGitHubToken,
  DEV_USER_ID,
} from "@/lib/auth/dev-auth"

// =============================================================================
// Types
// =============================================================================

export interface AuthResult {
  userId: string
}

export interface DecryptedCredentials {
  anthropicApiKey?: string
  anthropicAuthToken?: string
  anthropicAuthType: AnthropicAuthType
  openaiApiKey?: string
  opencodeApiKey?: string
  daytonaApiKey?: string
  geminiApiKey?: string
}

export type SandboxStatus = BranchStatus

// Prisma include types for sandbox queries
export interface SandboxWithCredentials {
  id: string
  sandboxId: string
  userId: string
  status: string
  contextId: string | null
  sessionId: string | null
  sessionAgent: string | null
  previewUrlPattern: string | null
  lastActiveAt: Date | null
  user: {
    credentials: {
      anthropicApiKey: string | null
      anthropicAuthToken: string | null
      anthropicAuthType: string | null
      openaiApiKey: string | null
      opencodeApiKey: string | null
      geminiApiKey: string | null
      daytonaApiKey: string | null
    } | null
  }
  branch: {
    id: string
    name: string
    agent: string
    model: string | null
    needsSync: boolean
    repo: {
      id: string
      name: string
      owner: string
    }
  } | null
}

export interface SandboxBasic {
  id: string
  sandboxId: string
  userId: string
  status: string
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
 *
 * When GITHUB_PAT is set (development only), returns the dev user ID
 * and ensures the dev user exists in the database.
 */
export async function getAuthUserId(): Promise<string | null> {
  // Check for dev auth bypass
  if (isAuthSkipped()) {
    warnAboutSkippedAuth()
    await ensureDevUserExists()
    return DEV_USER_ID
  }

  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

/**
 * Requires authentication - returns userId or throws Response
 * Usage: const userId = await requireAuth()
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
 * Requires admin authentication - returns userId or throws Response
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
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 })
  }

  return { userId }
}

// =============================================================================
// Environment Variable Helpers
// =============================================================================

/**
 * Gets the Daytona API key from environment
 * Returns the key or a server config error Response
 */
export function getDaytonaApiKey(): string | Response {
  const key = process.env.DAYTONA_API_KEY
  if (!key) {
    return serverConfigError("DAYTONA_API_KEY")
  }
  return key
}

/**
 * Helper to check if getDaytonaApiKey returned an error response
 */
export function isDaytonaKeyError(result: string | Response): result is Response {
  return result instanceof Response
}

// =============================================================================
// GitHub Token Helpers
// =============================================================================

export interface GitHubAuthResult {
  userId: string
  token: string
}

async function getPreferredGitHubToken(userId: string): Promise<string | null> {
  // Dev mode: use PAT from environment
  const devToken = getDevGitHubToken()
  if (devToken) {
    return devToken
  }

  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { githubId: true },
    }),
    prisma.account.findMany({
      where: { userId, provider: "github" },
      select: { access_token: true, providerAccountId: true, id: true },
      orderBy: { id: "asc" },
    }),
  ])

  if (accounts.length === 0) return null

  const preferred = user?.githubId
    ? accounts.find((account) => account.providerAccountId === user.githubId)
    : undefined

  const fallback = accounts[accounts.length - 1]
  return preferred?.access_token ?? fallback?.access_token ?? null
}

/**
 * Gets the authenticated user's GitHub token
 * Returns userId and token or an error Response
 * Combines session check, account lookup, and token validation in one call
 *
 * When GITHUB_PAT is set (development only), uses the dev user and the PAT
 * for all GitHub operations.
 */
export async function requireGitHubAuth(): Promise<GitHubAuthResult | Response> {
  let userId: string | null = null

  // Check for dev auth bypass
  if (isAuthSkipped()) {
    warnAboutSkippedAuth()
    await ensureDevUserExists()
    userId = DEV_USER_ID
  } else {
    const session = await getServerSession(authOptions)
    userId = session?.user?.id ?? null
  }

  if (!userId) {
    return unauthorized()
  }

  const token = await getPreferredGitHubToken(userId)

  if (!token) {
    return Response.json({ error: "GitHub account not linked" }, { status: 401 })
  }

  return { userId, token }
}

/**
 * Helper to check if requireGitHubAuth returned an error response
 */
export function isGitHubAuthError(result: GitHubAuthResult | Response): result is Response {
  return result instanceof Response
}

/**
 * Gets the GitHub token for a user by userId
 * Returns null if no GitHub account is linked
 */
export async function getGitHubTokenForUser(userId: string): Promise<string | null> {
  return getPreferredGitHubToken(userId)
}

// =============================================================================
// Credential Helpers
// =============================================================================

/**
 * Raw credentials type from database
 */
interface RawCredentials {
  anthropicApiKey: string | null
  anthropicAuthToken: string | null
  anthropicAuthType: string | null
  openaiApiKey: string | null
  opencodeApiKey: string | null
  daytonaApiKey: string | null
  geminiApiKey: string | null
}

/**
 * Decrypts user credentials from database format
 * Returns typed credentials object with decrypted values
 *
 * NOTE: This does NOT check team membership.
 * Use resolveUserCredentials() for team-based credential sharing.
 */
export function decryptUserCredentials(
  credentials: RawCredentials | null
): DecryptedCredentials {
  const anthropicAuthType = (credentials?.anthropicAuthType || "api-key") as AnthropicAuthType

  let anthropicApiKey: string | undefined
  let anthropicAuthToken: string | undefined
  let openaiApiKey: string | undefined
  let opencodeApiKey: string | undefined
  let daytonaApiKey: string | undefined
  let geminiApiKey: string | undefined

  if (credentials?.anthropicApiKey) {
    anthropicApiKey = decrypt(credentials.anthropicApiKey)
  }
  if (credentials?.anthropicAuthToken) {
    anthropicAuthToken = decrypt(credentials.anthropicAuthToken)
  }
  if (credentials?.openaiApiKey) {
    openaiApiKey = decrypt(credentials.openaiApiKey)
  }
  if (credentials?.opencodeApiKey) {
    opencodeApiKey = decrypt(credentials.opencodeApiKey)
  }
  if (credentials?.daytonaApiKey) {
    daytonaApiKey = decrypt(credentials.daytonaApiKey)
  }
  if (credentials?.geminiApiKey) {
    geminiApiKey = decrypt(credentials.geminiApiKey)
  }

  return {
    anthropicApiKey,
    anthropicAuthToken,
    anthropicAuthType,
    openaiApiKey,
    opencodeApiKey,
    daytonaApiKey,
    geminiApiKey,
  }
}

/**
 * Resolves and decrypts user credentials, checking team membership.
 * If user is a team member, uses the team owner's Claude subscription (anthropicAuthToken only).
 *
 * @param credentials - The user's credentials from database
 * @param userId - The user's ID (needed to check team membership)
 * @returns Decrypted credentials (with team owner's anthropicAuthToken if member)
 */
export async function resolveUserCredentials(
  credentials: RawCredentials | null,
  userId?: string
): Promise<DecryptedCredentials> {
  const ownCredentials = decryptUserCredentials(credentials)

  // If no userId provided, can't check team membership
  if (!userId) {
    return ownCredentials
  }

  // Check if user is a team member
  const teamMember = await prisma.teamMember.findUnique({
    where: { userId },
    include: {
      team: {
        include: {
          owner: {
            include: { credentials: true }
          }
        }
      }
    }
  })

  // If user is a team member and owner has Claude subscription, use it
  if (teamMember?.team?.owner?.credentials?.anthropicAuthToken) {
    return {
      ...ownCredentials,
      anthropicAuthToken: decrypt(teamMember.team.owner.credentials.anthropicAuthToken),
      anthropicAuthType: "claude-max" as AnthropicAuthType,
    }
  }

  return ownCredentials
}

// =============================================================================
// Database Query Helpers
// =============================================================================

/**
 * Fetches a sandbox by ID and verifies ownership
 * Includes user credentials and branch/repo info
 * Returns null if not found or not owned by user
 */
export async function getSandboxWithAuth(
  sandboxId: string,
  userId: string
): Promise<SandboxWithCredentials | null> {
  const sandbox = await prisma.sandbox.findUnique({
    where: { sandboxId },
    include: INCLUDE_SANDBOX_WITH_USER_CREDENTIALS,
  })

  if (!sandbox || sandbox.userId !== userId) {
    return null
  }

  return sandbox as SandboxWithCredentials
}

/**
 * Fetches a sandbox by ID with minimal data and verifies ownership
 * Use this when you don't need credentials or branch info
 */
export async function getSandboxBasicWithAuth(
  sandboxId: string,
  userId: string
): Promise<SandboxBasic | null> {
  const sandbox = await prisma.sandbox.findUnique({
    where: { sandboxId },
  })

  if (!sandbox || sandbox.userId !== userId) {
    return null
  }

  return sandbox as SandboxBasic
}

/**
 * Fetches a branch by ID and verifies ownership through repo relationship
 * Returns null if not found or not owned by user
 */
export async function getBranchWithAuth(
  branchId: string,
  userId: string
): Promise<{
  id: string
  name: string
  status: string
  repo: { id: string; userId: string; name: string; owner: string }
} | null> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: INCLUDE_BRANCH_WITH_REPO,
  })

  if (!branch || branch.repo.userId !== userId) {
    return null
  }

  return branch
}

/**
 * Fetches a repo by ID and verifies ownership
 * Returns null if not found or not owned by user
 */
export async function getRepoWithAuth(
  repoId: string,
  userId: string
): Promise<{
  id: string
  userId: string
  name: string
  owner: string
  defaultBranch: string
} | null> {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
  })

  if (!repo || repo.userId !== userId) {
    return null
  }

  return repo
}

// =============================================================================
// Status Update Helpers
// =============================================================================

/**
 * Updates sandbox and optionally branch status in a single operation
 * Handles the common pattern of updating both records together
 */
export async function updateSandboxAndBranchStatus(
  sandboxDbId: string,
  branchDbId: string | null | undefined,
  status: SandboxStatus,
  extraSandboxData?: { lastActiveAt?: Date }
): Promise<void> {
  const sandboxResult = await prisma.sandbox.updateMany({
    where: { id: sandboxDbId },
    data: {
      status,
      ...extraSandboxData,
    },
  })
  if (sandboxResult.count === 0) {
    console.warn("[updateSandboxAndBranchStatus] sandbox row missing; updating branch only if any", {
      sandboxDbId,
      branchDbId,
    })
  }

  if (branchDbId) {
    await prisma.branch.updateMany({
      where: { id: branchDbId },
      data: { status },
    })
  }
}

/**
 * Resets sandbox and branch status to idle
 * Convenience wrapper for the common error recovery pattern
 */
export async function resetSandboxStatus(
  sandboxDbId: string,
  branchDbId: string | null | undefined
): Promise<void> {
  await updateSandboxAndBranchStatus(sandboxDbId, branchDbId, BRANCH_STATUS.IDLE)
}
