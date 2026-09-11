/**
 * HTTP client for OpenAI's OAuth endpoints, as used by the Codex CLI.
 *
 * No DB access and no logging of token material. Endpoints come from OpenAI's
 * OIDC discovery document at
 * https://auth.openai.com/.well-known/openid-configuration.
 */
import "server-only"
import type { CodexTokenResponse } from "@/lib/codex-credentials"

/** The Codex CLI's public OAuth client. No secret; `none` is an accepted auth method. */
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

const TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token"
const REVOKE_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/revoke"

/**
 * The grant is gone and no retry will help — the user must reconnect.
 * Distinguished from transient failures so callers never burn a reconnect on
 * a 503.
 */
export class CodexReconnectRequiredError extends Error {
  constructor(reason: string) {
    super(`Codex credential must be reconnected: ${reason}`)
    this.name = "CodexReconnectRequiredError"
  }
}

/**
 * Clamp a server-supplied OAuth `error` code before it reaches a thrown
 * message or a log line.
 *
 * RFC 6749 keeps `error` to a short ASCII token, but nothing here forces the
 * endpoint to honour that, and this module's whole job is to make sure no
 * remote-controlled text can carry secrets out through an error string.
 * Anything that isn't a plausible code is dropped rather than echoed.
 */
function sanitizeErrorCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  return /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : null
}

/** OAuth errors that mean the refresh token is permanently unusable. */
const TERMINAL_ERRORS = new Set([
  "invalid_grant",
  "refresh_token_reused",
  "invalid_client",
  "unauthorized_client",
])

/**
 * Exchange a refresh token for a fresh access token.
 *
 * Every call rotates the refresh token: the caller MUST persist
 * `res.refresh_token` in the same transaction that read the old one.
 */
export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Bounds how long a caller can hold a transaction-scoped row lock open
    // for this call. Does NOT prevent a lost rotation on its own — OpenAI may
    // already have processed the request by the time this fires — but it
    // turns a hang into a fast, catchable transient failure well before the
    // caller's own transaction timeout would abort mid-flight.
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CODEX_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  })

  const text = await res.text()

  if (!res.ok) {
    let code = "unknown_error"
    try {
      code = sanitizeErrorCode((JSON.parse(text) as { error?: string }).error) ?? code
    } catch {
      // Non-JSON error body; the status code is all we have.
    }
    // Never interpolate the token or the raw body — either can carry secrets.
    if (TERMINAL_ERRORS.has(code)) throw new CodexReconnectRequiredError(code)
    throw new Error(`Codex token refresh failed (HTTP ${res.status}, ${code})`)
  }

  let parsed: Partial<CodexTokenResponse>
  try {
    parsed = JSON.parse(text) as Partial<CodexTokenResponse>
  } catch {
    // Never let JSON.parse's SyntaxError propagate here — on this branch
    // `text` is the token-bearing success body, and V8 embeds a snippet of
    // the offending input in that message.
    throw new Error("Codex token refresh returned a malformed response body")
  }
  // Guard the SHAPE, not just truthiness. `parsed` is whatever the endpoint
  // sent: JSON `null` would make the property reads below throw a raw
  // TypeError instead of this message, and a stringified `expires_in`
  // ("864000") would pass a truthiness check and then silently become string
  // concatenation in `nowSec + expires_in` downstream, producing a nonsense
  // expiry decades away.
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.access_token !== "string" ||
    typeof parsed.refresh_token !== "string" ||
    typeof parsed.id_token !== "string" ||
    typeof parsed.expires_in !== "number" ||
    !Number.isFinite(parsed.expires_in) ||
    (parsed.earliest_refresh_at !== undefined &&
      typeof parsed.earliest_refresh_at !== "number")
  ) {
    throw new Error("Codex token refresh returned an incomplete response")
  }
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    id_token: parsed.id_token,
    expires_in: parsed.expires_in,
    earliest_refresh_at: parsed.earliest_refresh_at,
  }
}

/**
 * Revoke a grant. Best-effort by design: the caller is disconnecting or
 * reconnecting either way, so a failure is reported, not thrown.
 */
export async function revokeCodexToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID, token: refreshToken }),
    })
    return res.ok
  } catch {
    return false
  }
}
