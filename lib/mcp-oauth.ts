import { encrypt, decrypt } from "@/lib/encryption"
import { prisma } from "@/lib/prisma"
import { createHash, randomBytes } from "crypto"

// MCP OAuth state structure
export interface McpOAuthState {
  repoId: string
  serverId: string
  slug: string
  url: string
  name: string
  iconUrl?: string
  timestamp: number
  codeVerifier: string // PKCE code verifier
  clientId?: string // Client ID from dynamic registration
}

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
export interface OAuthMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  code_challenge_methods_supported?: string[]
}

// Dynamic client registration response (RFC 7591)
export interface ClientRegistrationResponse {
  client_id: string
  client_secret?: string
  client_id_issued_at?: number
  client_secret_expires_at?: number
}

// OAuth state expiry (10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000

/**
 * Generate PKCE code verifier (43-128 characters, URL-safe)
 * Required for OAuth 2.1
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Generate PKCE code challenge from verifier (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest()
  return hash.toString("base64url")
}

/**
 * Get the authorization base URL from an MCP server URL
 * Per MCP spec: discard any path component
 */
export function getAuthBaseUrl(mcpServerUrl: string): string {
  const url = new URL(mcpServerUrl)
  return `${url.protocol}//${url.host}`
}

/**
 * Fetch OAuth metadata from MCP server
 * Returns discovered endpoints or null if not available
 */
export async function fetchOAuthMetadata(mcpServerUrl: string): Promise<OAuthMetadata | null> {
  const baseUrl = getAuthBaseUrl(mcpServerUrl)
  const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`

  try {
    const response = await fetch(metadataUrl, {
      headers: {
        "MCP-Protocol-Version": "2024-11-05",
      },
    })

    if (!response.ok) {
      console.log(`[MCP OAuth] Metadata discovery returned ${response.status} for ${baseUrl}`)
      return null
    }

    const metadata = await response.json()
    return metadata as OAuthMetadata
  } catch (err) {
    console.log("[MCP OAuth] Metadata discovery failed:", err)
    return null
  }
}

/**
 * Get OAuth endpoints (from metadata or use defaults)
 * Per MCP spec: first try metadata discovery, then fall back to defaults
 */
export async function getOAuthEndpoints(mcpServerUrl: string): Promise<{
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
}> {
  const baseUrl = getAuthBaseUrl(mcpServerUrl)
  const metadata = await fetchOAuthMetadata(mcpServerUrl)

  if (metadata) {
    console.log("[MCP OAuth] Using discovered endpoints from metadata")
    return {
      authorizationEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      registrationEndpoint: metadata.registration_endpoint || null,
    }
  }

  // Fall back to default endpoints per MCP spec
  console.log("[MCP OAuth] Using default endpoints for", baseUrl)
  return {
    authorizationEndpoint: `${baseUrl}/authorize`,
    tokenEndpoint: `${baseUrl}/token`,
    registrationEndpoint: `${baseUrl}/register`,
  }
}

/**
 * Perform dynamic client registration (RFC 7591)
 * Returns client credentials or null if registration fails/not supported
 */
export async function registerClient(
  registrationEndpoint: string,
  callbackUrl: string
): Promise<ClientRegistrationResponse | null> {
  try {
    console.log("[MCP OAuth] Attempting dynamic client registration at", registrationEndpoint)

    const response = await fetch(registrationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        redirect_uris: [callbackUrl],
        token_endpoint_auth_method: "none", // Public client
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Sandboxed Agents",
        client_uri: process.env.NEXTAUTH_URL || "http://localhost:3000",
      }),
    })

    if (!response.ok) {
      console.log(`[MCP OAuth] Dynamic registration returned ${response.status}`)
      return null
    }

    const data = await response.json()
    console.log("[MCP OAuth] Dynamic registration successful, client_id:", data.client_id)
    return data as ClientRegistrationResponse
  } catch (err) {
    console.log("[MCP OAuth] Dynamic registration failed:", err)
    return null
  }
}

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
      console.log("[MCP OAuth] State expired")
      return null
    }

    return state
  } catch (err) {
    console.error("[MCP OAuth] Failed to decode state:", err)
    return null
  }
}

/**
 * Exchange authorization code for tokens
 * Includes PKCE code_verifier as required by OAuth 2.1
 */
export async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string
): Promise<{
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
} | null> {
  try {
    console.log("[MCP OAuth] Exchanging code for tokens at", tokenEndpoint, {
      redirect_uri: redirectUri,
      client_id: clientId,
      code_length: code.length,
      code_verifier_length: codeVerifier.length,
    })

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[MCP OAuth] Token exchange failed:", response.status, errorText)
      return null
    }

    const tokens = await response.json()
    console.log("[MCP OAuth] Token exchange successful")
    return tokens
  } catch (err) {
    console.error("[MCP OAuth] Token exchange error:", err)
    return null
  }
}

/**
 * Refresh an access token
 */
export async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string
): Promise<{
  access_token: string
  refresh_token?: string
  expires_in?: number
} | null> {
  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    })

    if (!response.ok) {
      console.error("[MCP OAuth] Token refresh failed:", response.status)
      return null
    }

    return await response.json()
  } catch (err) {
    console.error("[MCP OAuth] Token refresh error:", err)
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
  const endpoints = await getOAuthEndpoints(server.url)

  // Use stored client_id or default
  const clientId = server.clientId || "sandboxed-agents"

  const tokens = await refreshAccessToken(endpoints.tokenEndpoint, refreshToken, clientId)

  if (!tokens) {
    await prisma.repoMcpServer.update({
      where: { id: serverId },
      data: {
        status: "expired",
        lastError: "Token expired. Please reconnect.",
      },
    })
    return false
  }

  const tokenExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null

  await prisma.repoMcpServer.update({
    where: { id: serverId },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : server.refreshToken,
      tokenExpiry,
      status: "connected",
      lastError: null,
    },
  })

  return true
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
