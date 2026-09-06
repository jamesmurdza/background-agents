/**
 * Shape and refresh policy for a stored ChatGPT-subscription Codex credential.
 *
 * Pure: no Prisma, no fetch, safe to unit test in isolation. The HTTP calls
 * live in lib/server/codex-oauth.ts and the DB access in
 * lib/server/codex-credentials.ts.
 *
 * Two different shapes travel under the name "codex credentials":
 *  - CodexStoredCredential — what WE persist (includes the real refresh token).
 *  - CodexCliAuthFile      — what the SANDBOX gets (refresh token deliberately
 *                            replaced with a placeholder).
 * Keeping them distinct is what guarantees a sandbox can never rotate the
 * user's grant and sign them out of their laptop.
 */

/** What we persist, encrypted, under the CODEX_CREDENTIALS credential id. */
export interface CodexStoredCredential {
  refresh_token: string
  access_token: string
  id_token: string
  account_id: string
  /** Unix seconds; when the access token expires. */
  expires_at: number
  /** Unix seconds; OpenAI's advisory "don't refresh before this" marker. */
  earliest_refresh_at: number
  /** ISO-8601; when we last minted. */
  last_refresh: string
  status: "connected" | "needs_reconnect"
}

/** The subset of OpenAI's token response we consume. */
export interface CodexTokenResponse {
  access_token: string
  refresh_token: string
  id_token: string
  expires_in: number
  earliest_refresh_at?: number
}

/** The on-disk file the Codex CLI reads at $CODEX_HOME/auth.json. */
export interface CodexCliAuthFile {
  OPENAI_API_KEY: string | null
  tokens: {
    id_token: string
    access_token: string
    refresh_token: string
    account_id: string
  }
  last_refresh: string
}

/**
 * Stand-in written into the sandbox in place of the real refresh token.
 *
 * `refresh_token` is a required field in the CLI's auth.json schema (omitting
 * it fails with "missing field `refresh_token`"), but the CLI only reads it
 * when it decides to refresh — which it won't, because we always inject a
 * token with days of life and a fresh `last_refresh`. Verified empirically:
 * a full `codex exec` turn ran against a placeholder without touching it.
 */
export const CODEX_PLACEHOLDER_REFRESH_TOKEN = "rt.PLACEHOLDER.managed-server-side"

/** Master switch. Off unless explicitly enabled. */
export const CODEX_SUBSCRIPTION_ENABLED =
  process.env.CODEX_SUBSCRIPTION_ENABLED === "1" ||
  process.env.CODEX_SUBSCRIPTION_ENABLED === "true"

/** Seconds before expiry that we assume as the refresh window when OpenAI omits one. */
const DEFAULT_REFRESH_LEAD_SECONDS = 86400

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

/**
 * Parse a stored credential. Returns null for anything that isn't a complete
 * credential — including a value some earlier version of the product may have
 * stored as a raw string.
 */
export function parseCodexCredential(
  raw: string | null | undefined
): CodexStoredCredential | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const c = parsed as Record<string, unknown>
  if (
    !isNonEmptyString(c.refresh_token) ||
    !isNonEmptyString(c.access_token) ||
    !isNonEmptyString(c.id_token) ||
    !isNonEmptyString(c.account_id) ||
    typeof c.expires_at !== "number" ||
    typeof c.earliest_refresh_at !== "number" ||
    !isNonEmptyString(c.last_refresh) ||
    (c.status !== "connected" && c.status !== "needs_reconnect")
  ) {
    return null
  }
  return {
    refresh_token: c.refresh_token,
    access_token: c.access_token,
    id_token: c.id_token,
    account_id: c.account_id,
    expires_at: c.expires_at,
    earliest_refresh_at: c.earliest_refresh_at,
    last_refresh: c.last_refresh,
    status: c.status,
  }
}

/** Build a stored credential from a token-endpoint response. */
export function credentialFromTokenResponse(
  res: CodexTokenResponse,
  accountId: string,
  nowMs: number
): CodexStoredCredential {
  const nowSec = Math.floor(nowMs / 1000)
  const expiresAt = nowSec + res.expires_in
  return {
    refresh_token: res.refresh_token,
    access_token: res.access_token,
    id_token: res.id_token,
    account_id: accountId,
    expires_at: expiresAt,
    earliest_refresh_at: res.earliest_refresh_at ?? expiresAt - DEFAULT_REFRESH_LEAD_SECONDS,
    last_refresh: new Date(nowMs).toISOString(),
    status: "connected",
  }
}

/**
 * Pull the token fields out of an auth.json the CLI wrote. Returns null when
 * the file describes an API-key login rather than a ChatGPT one.
 */
export function credentialFromCliAuthFile(
  raw: string
): Pick<CodexStoredCredential, "refresh_token" | "access_token" | "id_token" | "account_id"> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const tokens = (parsed as { tokens?: Record<string, unknown> } | null)?.tokens
  if (!tokens) return null
  if (
    !isNonEmptyString(tokens.refresh_token) ||
    !isNonEmptyString(tokens.access_token) ||
    !isNonEmptyString(tokens.id_token) ||
    !isNonEmptyString(tokens.account_id)
  ) {
    return null
  }
  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    account_id: tokens.account_id,
  }
}

/**
 * Whether to mint a new access token. OpenAI returns `earliest_refresh_at`
 * about 24h before expiry and we honour it, so a healthy credential refreshes
 * roughly once per 9 days. An already-expired token is refreshed regardless.
 */
export function needsRefresh(cred: CodexStoredCredential, nowMs: number): boolean {
  const nowSec = Math.floor(nowMs / 1000)
  return nowSec >= cred.earliest_refresh_at || nowSec >= cred.expires_at
}

/** Render the auth.json to write into a sandbox. */
export function buildCodexAuthJson(cred: CodexStoredCredential, nowMs: number): string {
  const file: CodexCliAuthFile = {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: cred.id_token,
      access_token: cred.access_token,
      refresh_token: CODEX_PLACEHOLDER_REFRESH_TOKEN,
      account_id: cred.account_id,
    },
    last_refresh: new Date(nowMs).toISOString(),
  }
  return JSON.stringify(file)
}
