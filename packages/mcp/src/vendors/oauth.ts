/**
 * OAuth for vendor-hosted MCP servers, following the MCP authorization spec:
 * protected resource metadata → authorization server metadata → dynamic
 * client registration → authorization code with PKCE and the RFC 8707
 * `resource` parameter → refresh.
 *
 * Plain functions with no storage. The caller keeps the registered client and
 * each user's tokens wherever it likes (the web app uses Postgres).
 */

import { SignJWT, jwtVerify } from "jose"
import { createHash, randomBytes } from "crypto"

export interface OAuthServerMetadata {
  /** Canonical URI of the MCP server, sent as `resource` on every request. */
  resource: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
  /** Space-separated scopes to request, or null to let the server decide. */
  scope: string | null
  tokenEndpointAuthMethods: string[]
}

export type ClientAuthMethod = "none" | "client_secret_post" | "client_secret_basic"

export interface OAuthClient {
  clientId: string
  clientSecret: string | null
  authMethod: ClientAuthMethod
}

export interface OAuthTokens {
  accessToken: string
  /** ms-epoch when the access token expires. */
  expiresAt: number
  /**
   * The refresh token to store from now on: the new one when the server
   * rotated it (every vendor we tested does), otherwise the one just used.
   */
  refreshToken: string
}

export class McpOAuthError extends Error {
  constructor(
    message: string,
    /** OAuth `error` code from the server, e.g. "invalid_grant". */
    readonly code?: string
  ) {
    super(message)
    this.name = "McpOAuthError"
  }
}

type FetchLike = typeof fetch

const REQUEST_TIMEOUT_MS = 15_000
/** Assumed lifetime when a token response has no `expires_in`. */
const DEFAULT_EXPIRES_IN_S = 3600
const STATE_AUDIENCE = "mcp-vendor-oauth-state"
const STATE_TTL = "10m"

const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "background-agents", version: "1.0" },
  },
})

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Find how to log in to an MCP server: an unauthenticated `initialize` for
 * the `WWW-Authenticate` hints, then the protected resource metadata, then
 * the authorization server metadata.
 */
export async function discoverOAuthMetadata(
  mcpUrl: string,
  fetchImpl: FetchLike = fetch
): Promise<OAuthServerMetadata> {
  const res = await fetchImpl(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: INITIALIZE_REQUEST,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const challenge = res.headers.get("www-authenticate") ?? ""
  // Open servers may answer with a stream; we only needed the headers.
  await res.body?.cancel().catch(() => {})

  const metadataHint = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
  const scopeHint = /scope="([^"]+)"/.exec(challenge)?.[1]

  const resourceMetadata = await firstJson(
    [...(metadataHint ? [metadataHint] : []), ...wellKnownUrls(mcpUrl, "oauth-protected-resource")],
    fetchImpl
  )
  const issuer =
    stringArray(resourceMetadata?.authorization_servers)[0] ?? new URL(mcpUrl).origin
  const serverMetadata = await firstJson(
    [
      ...wellKnownUrls(issuer, "oauth-authorization-server"),
      ...wellKnownUrls(issuer, "openid-configuration"),
    ],
    fetchImpl
  )
  const authorizationEndpoint = stringOrNull(serverMetadata?.authorization_endpoint)
  const tokenEndpoint = stringOrNull(serverMetadata?.token_endpoint)
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new McpOAuthError(`No OAuth authorization server metadata found for ${mcpUrl}`)
  }

  // Scope: what the server asked for in its challenge, else what the resource
  // advertises, plus offline_access when supported so we get a refresh token.
  const resourceScopes = stringArray(resourceMetadata?.scopes_supported)
  const scopes = (scopeHint ? scopeHint.split(" ") : resourceScopes).filter(Boolean)
  if (
    stringArray(serverMetadata?.scopes_supported).includes("offline_access") &&
    !scopes.includes("offline_access")
  ) {
    scopes.push("offline_access")
  }

  return {
    resource: stringOrNull(resourceMetadata?.resource) ?? mcpUrl,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: stringOrNull(serverMetadata?.registration_endpoint),
    scope: scopes.length > 0 ? scopes.join(" ") : null,
    tokenEndpointAuthMethods: stringArray(serverMetadata?.token_endpoint_auth_methods_supported),
  }
}

/** RFC 8414 / RFC 9728 path-aware well-known URLs, then the fallbacks. */
function wellKnownUrls(base: string, name: string): string[] {
  const url = new URL(base)
  const path = url.pathname.replace(/\/$/, "")
  const root = `${url.origin}/.well-known/${name}`
  return path ? [`${root}${path}`, root, `${url.origin}${path}/.well-known/${name}`] : [root]
}

async function firstJson(
  urls: string[],
  fetchImpl: FetchLike
): Promise<Record<string, unknown> | null> {
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) continue
      const data: unknown = await res.json()
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return data as Record<string, unknown>
      }
    } catch {
      // Try the next candidate URL.
    }
  }
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

// ---------------------------------------------------------------------------
// Client registration
// ---------------------------------------------------------------------------

/** A public client when the server allows one, otherwise a client secret. */
export function pickClientAuthMethod(supported: string[]): ClientAuthMethod {
  if (supported.length === 0 || supported.includes("none")) return "none"
  return supported.includes("client_secret_post") ? "client_secret_post" : "client_secret_basic"
}

/** Register a client with the server (RFC 7591 dynamic client registration). */
export async function registerOAuthClient(
  metadata: OAuthServerMetadata,
  options: { clientName: string; clientUri?: string; redirectUri: string },
  fetchImpl: FetchLike = fetch
): Promise<OAuthClient> {
  if (!metadata.registrationEndpoint) {
    throw new McpOAuthError("This server does not support dynamic client registration")
  }
  const requestedMethod = pickClientAuthMethod(metadata.tokenEndpointAuthMethods)
  const res = await fetchImpl(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: options.clientName,
      ...(options.clientUri ? { client_uri: options.clientUri } : {}),
      redirect_uris: [options.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: requestedMethod,
      ...(metadata.scope ? { scope: metadata.scope } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw await errorFromResponse("Client registration", res)

  const data = (await res.json()) as Record<string, unknown>
  const clientId = stringOrNull(data.client_id)
  if (!clientId) throw new McpOAuthError("Client registration returned no client_id")
  const returnedMethod = stringOrNull(data.token_endpoint_auth_method)
  return {
    clientId,
    clientSecret: stringOrNull(data.client_secret),
    authMethod: isClientAuthMethod(returnedMethod) ? returnedMethod : requestedMethod,
  }
}

function isClientAuthMethod(value: string | null): value is ClientAuthMethod {
  return value === "none" || value === "client_secret_post" || value === "client_secret_basic"
}

// ---------------------------------------------------------------------------
// Authorization code flow
// ---------------------------------------------------------------------------

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url")
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  return { codeVerifier, codeChallenge }
}

export function buildAuthorizationUrl(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  options: { redirectUri: string; state: string; codeChallenge: string }
): string {
  const url = new URL(metadata.authorizationEndpoint)
  const params = url.searchParams
  params.set("response_type", "code")
  params.set("client_id", client.clientId)
  params.set("redirect_uri", options.redirectUri)
  params.set("code_challenge", options.codeChallenge)
  params.set("code_challenge_method", "S256")
  params.set("state", options.state)
  params.set("resource", metadata.resource)
  if (metadata.scope) params.set("scope", metadata.scope)
  return url.toString()
}

/** Exchange the callback's code for tokens. Fails without a refresh token. */
export async function exchangeAuthorizationCode(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  options: { code: string; redirectUri: string; codeVerifier: string },
  fetchImpl: FetchLike = fetch
): Promise<OAuthTokens> {
  const data = await requestTokens(
    metadata,
    client,
    {
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    },
    fetchImpl
  )
  if (!data.refresh_token) {
    throw new McpOAuthError("The server did not return a refresh token")
  }
  return toTokens(data, data.refresh_token)
}

/**
 * Trade a refresh token for a new access token. Store the returned
 * `refreshToken`: servers that rotate refresh tokens reject the old one.
 */
export async function refreshAccessToken(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<OAuthTokens> {
  const data = await requestTokens(
    metadata,
    client,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl
  )
  return toTokens(data, data.refresh_token ?? refreshToken)
}

interface TokenResponse {
  access_token: string
  expires_in?: number
  refresh_token?: string
}

async function requestTokens(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  params: Record<string, string>,
  fetchImpl: FetchLike
): Promise<TokenResponse> {
  const form = new URLSearchParams({ client_id: client.clientId, resource: metadata.resource, ...params })
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  }
  if (client.clientSecret) {
    if (client.authMethod === "client_secret_basic") {
      const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`
      headers.Authorization = `Basic ${Buffer.from(pair).toString("base64")}`
    } else {
      form.set("client_secret", client.clientSecret)
    }
  }
  const res = await fetchImpl(metadata.tokenEndpoint, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw await errorFromResponse(`Token request (${params.grant_type})`, res)
  const data = (await res.json()) as Partial<TokenResponse>
  if (!data.access_token) throw new McpOAuthError("Token response had no access_token")
  return data as TokenResponse
}

function toTokens(data: TokenResponse, refreshToken: string): OAuthTokens {
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : DEFAULT_EXPIRES_IN_S
  return { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000, refreshToken }
}

/** Only the OAuth `error` fields, so a body can't leak anything into logs. */
async function errorFromResponse(what: string, res: Response): Promise<McpOAuthError> {
  let code: string | undefined
  let description = ""
  try {
    const body = (await res.json()) as Record<string, unknown>
    code = stringOrNull(body.error) ?? undefined
    description = stringOrNull(body.error_description) ?? ""
  } catch {
    // Non-JSON error body; the status is enough.
  }
  const detail = [code, description.slice(0, 200)].filter(Boolean).join(": ")
  return new McpOAuthError(`${what} failed with HTTP ${res.status}${detail ? ` (${detail})` : ""}`, code)
}

// ---------------------------------------------------------------------------
// OAuth `state`
// ---------------------------------------------------------------------------

export interface OAuthStateClaims {
  userId: string
  vendor: string
  codeVerifier: string
}

/**
 * Sign the OAuth `state`. It binds the callback to the user and vendor that
 * started the flow and carries the PKCE verifier, so no server-side session
 * store is needed.
 */
export async function signOAuthState(secret: string, claims: OAuthStateClaims): Promise<string> {
  return await new SignJWT({ vendor: claims.vendor, codeVerifier: claims.codeVerifier })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(new TextEncoder().encode(secret))
}

/** The claims of a valid state, or null if it's invalid, expired or forged. */
export async function verifyOAuthState(secret: string, state: string): Promise<OAuthStateClaims | null> {
  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret), {
      audience: STATE_AUDIENCE,
    })
    if (!payload.sub || typeof payload.vendor !== "string" || typeof payload.codeVerifier !== "string") {
      return null
    }
    return { userId: payload.sub, vendor: payload.vendor, codeVerifier: payload.codeVerifier }
  } catch {
    return null
  }
}
