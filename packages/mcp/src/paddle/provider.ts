/**
 * Paddle MCP provider — OAuth (authorization_code + PKCE) against Paddle's
 * own authorization server (id.paddle.com), minting access tokens for
 * Paddle's hosted MCP server (mcp.paddle.com/mcp).
 *
 * Unlike Gmail, we don't proxy through our own MCP server — Paddle hosts the
 * MCP endpoint directly, so the agent gets Paddle's access token straight
 * (same shape as the GitHub installation-token provider). The refresh token
 * is the durable credential we store per user; access tokens are minted
 * lazily per turn and cached in-process.
 *
 * Paddle supports public OAuth clients (`token_endpoint_auth_method: "none"`)
 * with PKCE, so there's no client secret to hold — only a `clientId`, which
 * is registered once (via Paddle's dynamic client registration endpoint, or
 * manually) and kept as a static config value, same as Google's clientId.
 */

import { SignJWT, jwtVerify } from "jose"
import { createHash, randomBytes } from "crypto"
import {
  PADDLE_OAUTH_AUTHORIZE_URL,
  PADDLE_OAUTH_SCOPE,
  PADDLE_OAUTH_TOKEN_URL,
  PADDLE_MCP_URL,
  PADDLE_MCP_QUALIFIED_NAME,
  PADDLE_MCP_RESOURCE,
} from "./constants"
import type { IMcpProvider } from "../types"

export interface PaddleMcpConfig {
  /** Paddle OAuth client ID (public client, no secret). */
  clientId: string
  /** HMAC secret for OAuth `state` (also carries the PKCE verifier). */
  jwtSecret: string
}

interface AccessToken {
  token: string
  /** ms-epoch when Paddle will reject this token. */
  expiresAt: number
}

/** Matches the Gmail/GitHub providers: refresh 5 minutes before expiry. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000

/** OAuth `state` binds the Paddle callback to the user who started it. */
const OAUTH_STATE_TTL = "10m"
const OAUTH_STATE_AUDIENCE = "paddle-oauth-state"

export function createPaddleMcpProvider(config: PaddleMcpConfig): PaddleMcpProvider {
  return new PaddleMcpProvider(config)
}

export class PaddleMcpProvider implements IMcpProvider {
  readonly qualifiedName = PADDLE_MCP_QUALIFIED_NAME
  readonly displayName = "Paddle"
  readonly mcpUrl = PADDLE_MCP_URL

  private readonly config: PaddleMcpConfig
  private readonly secret: Uint8Array
  private readonly accessTokenCache = new Map<string, AccessToken>()

  constructor(config: PaddleMcpConfig) {
    this.config = config
    this.secret = new TextEncoder().encode(config.jwtSecret)
  }

  /**
   * Build the consent URL plus a signed `state` that carries both the user
   * id and the PKCE code verifier — so the callback can complete the
   * exchange without a separate server-side session store.
   */
  async getAuthUrl(redirectUri: string, userId: string): Promise<string> {
    const codeVerifier = randomBytes(32).toString("base64url")
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
    const state = await this.signOAuthState(userId, codeVerifier)

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: PADDLE_OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      resource: PADDLE_MCP_RESOURCE,
      state,
    })
    return `${PADDLE_OAUTH_AUTHORIZE_URL}?${params}`
  }

  /** Sign the OAuth `state`, embedding the PKCE verifier as a claim. */
  private async signOAuthState(userId: string, codeVerifier: string): Promise<string> {
    return await new SignJWT({ codeVerifier })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setAudience(OAUTH_STATE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(OAUTH_STATE_TTL)
      .sign(this.secret)
  }

  /**
   * Returns the user id the state was issued to and the PKCE verifier it
   * carried, or null if the state is invalid/expired/forged.
   */
  async verifyOAuthState(state: string): Promise<{ userId: string; codeVerifier: string } | null> {
    try {
      const { payload } = await jwtVerify(state, this.secret, { audience: OAUTH_STATE_AUDIENCE })
      if (!payload.sub || typeof payload.codeVerifier !== "string") return null
      return { userId: payload.sub, codeVerifier: payload.codeVerifier }
    } catch {
      // Expected for expired/forged tokens; callers treat null as unauthorized.
      return null
    }
  }

  /** Exchange the callback's authorization code (+ PKCE verifier) for a refresh token. */
  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<string> {
    const data = await this.requestToken({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    })
    if (!data.refresh_token) {
      throw new Error("Paddle did not return a refresh token — was the offline_access scope granted?")
    }
    return data.refresh_token
  }

  /**
   * Mint a fresh access token, keyed/cached by userId. Like the GitHub
   * provider, agent-servers.ts calls this once per turn rather than trying
   * to keep a cached token in sync with the DB. Unlike GitHub's App-level
   * installationId, the durable credential here is the user's own refresh
   * token, decrypted by the caller before invoking this.
   */
  async getToken(userId: string, refreshToken: string): Promise<string> {
    const cached = this.accessTokenCache.get(userId)
    if (cached && cached.expiresAt - Date.now() > REFRESH_BEFORE_MS) {
      return cached.token
    }
    const data = await this.requestToken({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
    this.accessTokenCache.set(userId, {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    })
    return data.access_token
  }

  /** Drop a cached access token — used after disconnect. */
  invalidateToken(userId: string): void {
    this.accessTokenCache.delete(userId)
  }

  private async requestToken(
    params: Record<string, string>
  ): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    const res = await fetch(PADDLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        resource: PADDLE_MCP_RESOURCE,
        ...params,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Paddle token request failed: ${res.status} ${body}`)
    }
    return (await res.json()) as {
      access_token: string
      expires_in: number
      refresh_token?: string
    }
  }
}
