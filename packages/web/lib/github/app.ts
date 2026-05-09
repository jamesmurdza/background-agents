/**
 * GitHub App helpers — JWT signing + installation access tokens.
 *
 * Our GitHub App's purpose is to grant the agent properly-scoped access to
 * users' repos (issues:write, PRs:write, etc.) via short-lived installation
 * access tokens. Smithery's hosted GitHub OAuth app doesn't include those
 * scopes, so we sidestep it: we mint installation tokens here and pass them
 * to Smithery's connection as an `Authorization: Bearer …` header.
 *
 * Tokens are cached in-process by installationId until ~5 min before expiry.
 * The first call after expiry triggers a re-mint and tells the caller via
 * `rotated: true` so it can also push the new header to Smithery.
 */

import { SignJWT } from "jose"
import { createPrivateKey, type KeyObject } from "crypto"

interface InstallationToken {
  token: string
  /** ms-epoch when GitHub will reject this token. */
  expiresAt: number
}

const tokenCache = new Map<string, InstallationToken>()

/**
 * Refresh tokens this many ms *before* their hard expiry, so we never hand
 * out a token that's about to die mid-request.
 */
const REFRESH_BEFORE_MS = 5 * 60 * 1000

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/**
 * Read and parse the App's private key. We accept either:
 *   - a single-line PEM with literal `\n` between rows (typical .env style)
 *   - a real multi-line PEM (works in some env loaders)
 * Node's createPrivateKey accepts both PKCS#1 (`BEGIN RSA PRIVATE KEY`) and
 * PKCS#8 (`BEGIN PRIVATE KEY`) — GitHub hands out PKCS#1, so this matters.
 */
let _cachedKey: KeyObject | null = null
function getPrivateKey(): KeyObject {
  if (_cachedKey) return _cachedKey
  const raw = readEnv("GITHUB_APP_PRIVATE_KEY")
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
  _cachedKey = createPrivateKey({ key: pem, format: "pem" })
  return _cachedKey
}

/**
 * Sign a 9-minute JWT identifying our GitHub App. GitHub's hard limit is 10
 * minutes; we leave a minute of slack and backdate `iat` 60s for clock skew.
 */
async function signAppJwt(): Promise<string> {
  const key = getPrivateKey()
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 540)
    .setIssuer(readEnv("GITHUB_APP_ID"))
    .sign(key)
}

/**
 * Exchange the App JWT for a 1-hour installation access token. This token is
 * what the agent's tool calls actually use against api.github.com.
 */
async function mintInstallationToken(
  installationId: string
): Promise<InstallationToken> {
  const jwt = await signAppJwt()
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub installation token request failed: ${res.status} ${body}`
    )
  }
  const data = (await res.json()) as { token: string; expires_at: string }
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  }
}

/**
 * Get a fresh installation token. Returns `rotated: true` only when we
 * actually re-minted, so callers know they need to push the new header to
 * any downstream system that caches it (e.g. Smithery's connection headers).
 */
export async function getInstallationToken(
  installationId: string
): Promise<InstallationToken & { rotated: boolean }> {
  const cached = tokenCache.get(installationId)
  const now = Date.now()
  if (cached && cached.expiresAt - now > REFRESH_BEFORE_MS) {
    return { ...cached, rotated: false }
  }
  const fresh = await mintInstallationToken(installationId)
  tokenCache.set(installationId, fresh)
  return { ...fresh, rotated: true }
}

/** Drop a cached token — used after a connection delete or hard error. */
export function invalidateInstallationToken(installationId: string): void {
  tokenCache.delete(installationId)
}

/**
 * The remote MCP endpoint we point Smithery at. GitHub's hosted MCP server
 * accepts `Authorization: Bearer <PAT-or-installation-token>` and exposes the
 * full GitHub MCP tool surface — issues, PRs, repos, code search, etc.
 */
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"

/** Public app slug used to build the install URL. */
export function getAppSlug(): string {
  return readEnv("GITHUB_APP_SLUG")
}

/** Where to send the user to install/authorize the App. */
export function getInstallUrl(): string {
  return `https://github.com/apps/${getAppSlug()}/installations/new`
}
