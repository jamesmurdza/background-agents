/**
 * Renewing a Claude subscription's OAuth access token from its refresh token
 * (server-only): the same call Claude Code makes itself, a plain HTTPS POST,
 * so it needs no browser and no sandbox.
 *
 * Endpoint, client id, body and the dead-token check are Claude Code's own
 * (read from its CLI, 2.1.312); CLAUDE_OAUTH_TOKEN_URL / CLAUDE_OAUTH_CLIENT_ID
 * override them.
 * Refresh tokens rotate: the response's replaces the one spent, which is dead
 * from then on, so a caller must persist the result before anything else —
 * and must hold a lock while spending one (see refresh-claude-credentials,
 * user-claude-credentials).
 */

import "server-only"
import type { ClaudeOAuthCredentials } from "@background-agents/claude-credentials"

const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
/** Claude Code's default scopes, for a credential that doesn't list its own. */
const DEFAULT_SCOPES = ["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers"]
const TIMEOUT_MS = 15_000

/** The refresh token was refused (expired or revoked): only a new login helps. */
export class ClaudeRefreshRejectedError extends Error {
  constructor(status: number) {
    super(`Claude refresh token rejected (HTTP ${status})`)
    this.name = "ClaudeRefreshRejectedError"
  }
}

/**
 * `value` as a stored Claude subscription credential (~/.claude/.credentials.json),
 * or null when it carries no access token. Its refresh token may be missing.
 */
export function parseClaudeCredentials(value: string): ClaudeOAuthCredentials | null {
  try {
    const parsed = JSON.parse(value) as Partial<ClaudeOAuthCredentials> | null
    const oauth = parsed?.claudeAiOauth
    if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) return null
    return parsed as ClaudeOAuthCredentials
  } catch {
    // Parser errors can quote the token.
    return null
  }
}

/** Whether the access token in `creds` expires within `marginMs` (or carries no expiry). */
export function claudeTokenExpiring(creds: ClaudeOAuthCredentials, marginMs: number, now = Date.now()): boolean {
  const { expiresAt } = creds.claudeAiOauth
  return typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt - now <= marginMs
}

/**
 * Spend `creds`' refresh token for a new access token. Returns the updated
 * credentials, every other field kept. Throws {@link ClaudeRefreshRejectedError}
 * when the refresh token is dead, a plain Error (never quoting a token) for
 * anything transient.
 */
export async function refreshClaudeOAuth(
  creds: ClaudeOAuthCredentials,
  now = Date.now()
): Promise<ClaudeOAuthCredentials> {
  const oauth = creds.claudeAiOauth
  if (typeof oauth.refreshToken !== "string" || !oauth.refreshToken) throw new ClaudeRefreshRejectedError(0)
  const scopes = Array.isArray(oauth.scopes) && oauth.scopes.length > 0 ? oauth.scopes : DEFAULT_SCOPES
  let response: Response
  try {
    response = await fetch(process.env.CLAUDE_OAUTH_TOKEN_URL || TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: process.env.CLAUDE_OAUTH_CLIENT_ID || CLIENT_ID,
        scope: scopes.join(" "),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(`Claude token refresh request failed: ${err instanceof Error ? err.name : "unknown error"}`)
  }
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
    error_uri?: unknown
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
  } | null
  if (!response.ok) {
    // OAuth's "this refresh token is no good", as Claude Code reads it: a
    // string `error` or an object's `type`. One with an error_uri is an
    // account on hold, not a dead token. Anything else may pass.
    const code = typeof body?.error === "string" ? body.error : (body?.error as { type?: unknown } | undefined)?.type
    if ((response.status === 400 || response.status === 401) && code === "invalid_grant" && !body?.error_uri) {
      throw new ClaudeRefreshRejectedError(response.status)
    }
    throw new Error(`Claude token refresh failed (HTTP ${response.status})`)
  }
  if (!body || typeof body.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number") {
    throw new Error("Claude token refresh returned no access token")
  }
  return {
    ...creds,
    claudeAiOauth: {
      ...oauth,
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : oauth.refreshToken,
      expiresAt: now + body.expires_in * 1000,
      scopes: typeof body.scope === "string" && body.scope ? body.scope.split(" ") : oauth.scopes,
    },
  }
}
