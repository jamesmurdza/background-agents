import { encrypt, decrypt } from "@/lib/encryption"
import { prisma } from "@/lib/prisma"

// MCP OAuth state structure
export interface McpOAuthState {
  repoId: string
  serverId: string
  slug: string
  url: string
  name: string
  iconUrl?: string
  timestamp: number
}

// OAuth state expiry (10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000

/**
 * Encode OAuth state for URL
 */
export function encodeOAuthState(state: McpOAuthState): string {
  const json = JSON.stringify(state)
  const encrypted = encrypt(json)
  return Buffer.from(encrypted).toString("base64url")
}

/**
 * Decode OAuth state from URL
 */
export function decodeOAuthState(encoded: string): McpOAuthState | null {
  try {
    const encrypted = Buffer.from(encoded, "base64url").toString()
    const json = decrypt(encrypted)
    const state = JSON.parse(json) as McpOAuthState

    // Check expiry
    if (Date.now() - state.timestamp > STATE_EXPIRY_MS) {
      return null
    }

    return state
  } catch {
    return null
  }
}

/**
 * Decrypt MCP server tokens
 */
export function decryptMcpTokens(server: {
  accessToken: string | null
  refreshToken: string | null
}): {
  accessToken: string | null
  refreshToken: string | null
} {
  return {
    accessToken: server.accessToken ? decrypt(server.accessToken) : null,
    refreshToken: server.refreshToken ? decrypt(server.refreshToken) : null,
  }
}

/**
 * Check if token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(tokenExpiry: Date | null): boolean {
  if (!tokenExpiry) return false
  const expiryBuffer = 5 * 60 * 1000 // 5 minutes
  return tokenExpiry.getTime() - Date.now() < expiryBuffer
}

/**
 * Refresh OAuth token for an MCP server
 * Returns true if refresh was successful, false otherwise
 */
export async function refreshMcpToken(serverId: string): Promise<boolean> {
  const server = await prisma.repoMcpServer.findUnique({
    where: { id: serverId },
  })

  if (!server || !server.refreshToken) {
    return false
  }

  const refreshToken = decrypt(server.refreshToken)

  // TODO: Implement actual token refresh with MCP server's OAuth endpoint
  // This requires knowledge of each MCP server's OAuth configuration
  // For now, we mark it as expired and require re-authentication

  console.log(`Token refresh needed for MCP server ${server.slug}`)

  await prisma.repoMcpServer.update({
    where: { id: serverId },
    data: {
      status: "expired",
      lastError: "Token expired. Please reconnect.",
    },
  })

  return false
}

/**
 * Update MCP server tokens after OAuth callback
 */
export async function updateMcpServerTokens(
  serverId: string,
  tokens: {
    accessToken: string
    refreshToken?: string
    expiresIn?: number // seconds
  }
): Promise<void> {
  const tokenExpiry = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000)
    : null

  await prisma.repoMcpServer.update({
    where: { id: serverId },
    data: {
      accessToken: encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiry,
      status: "connected",
      lastError: null,
    },
  })
}

/**
 * Mark MCP server as errored
 */
export async function markMcpServerError(
  serverId: string,
  error: string
): Promise<void> {
  await prisma.repoMcpServer.update({
    where: { id: serverId },
    data: {
      status: "error",
      lastError: error,
    },
  })
}
