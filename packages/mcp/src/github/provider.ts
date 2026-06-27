/**
 * GitHub MCP provider — JWT signing + installation access tokens.
 *
 * The provider points the agent at GitHub's hosted MCP server
 * (api.githubcopilot.com/mcp/) and authenticates with a short-lived
 * installation access token minted from a GitHub App. The agent never sees the
 * App private key, only the per-request bearer token.
 *
 * Tokens are cached in-process by installationId and re-minted lazily before
 * expiry. We mint a fresh token at the start of each agent turn (where the
 * caller plugs it into the per-agent MCP config), so the 5-min refresh slack
 * here is purely a safety net against handing out an about-to-expire token.
 */

import { SignJWT } from "jose"
import { createPrivateKey, type KeyObject } from "crypto"
import type { ITokenMintingProvider } from "../types"
import { GITHUB_MCP_URL, GITHUB_MCP_QUALIFIED_NAME } from "./constants"

/**
 * Configuration for creating a GitHub MCP provider.
 */
export interface GitHubMcpConfig {
  /** GitHub App ID. */
  appId: string
  /** GitHub App slug (used for install URL). */
  appSlug: string
  /**
   * GitHub App private key in PEM format.
   * Accepts single-line PEM with literal `\n` between rows (typical .env style)
   * or real multi-line PEM (some env loaders).
   */
  privateKey: string
}

interface InstallationToken {
  token: string
  /** ms-epoch when GitHub will reject this token. */
  expiresAt: number
}

/** Refresh tokens 5 minutes before expiry to avoid handing out stale tokens. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000

/**
 * Create a GitHub MCP provider instance.
 *
 * The provider handles JWT signing with the App's private key and mints
 * short-lived installation tokens for agent use.
 */
export function createGitHubMcpProvider(
  config: GitHubMcpConfig
): GitHubMcpProvider {
  return new GitHubMcpProvider(config)
}

export class GitHubMcpProvider implements ITokenMintingProvider {
  readonly qualifiedName = GITHUB_MCP_QUALIFIED_NAME
  readonly displayName = "GitHub"
  readonly mcpUrl = GITHUB_MCP_URL

  private readonly config: GitHubMcpConfig
  private readonly tokenCache = new Map<string, InstallationToken>()
  private cachedKey: KeyObject | null = null

  constructor(config: GitHubMcpConfig) {
    this.config = config
  }

  /**
   * Get the URL to send users to for installing/authorizing the GitHub App.
   */
  getInstallUrl(): string {
    return `https://github.com/apps/${this.config.appSlug}/installations/new`
  }

  /**
   * Mint a fresh installation token. Refreshes lazily when within
   * REFRESH_BEFORE_MS of expiry so callers never get an about-to-die token.
   */
  async getToken(installationId: string): Promise<string> {
    const cached = this.tokenCache.get(installationId)
    const now = Date.now()
    if (cached && cached.expiresAt - now > REFRESH_BEFORE_MS) {
      return cached.token
    }
    const fresh = await this.mintInstallationToken(installationId)
    this.tokenCache.set(installationId, fresh)
    return fresh.token
  }

  /**
   * Drop a cached token — used after disconnect.
   */
  invalidateToken(installationId: string): void {
    this.tokenCache.delete(installationId)
  }

  /**
   * Parse the App private key. Accepts:
   *   - single-line PEM with literal `\n` between rows (typical .env style)
   *   - real multi-line PEM (some env loaders)
   * Node's createPrivateKey accepts both PKCS#1 and PKCS#8.
   */
  private getPrivateKey(): KeyObject {
    if (this.cachedKey) return this.cachedKey
    const raw = this.config.privateKey
    const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
    this.cachedKey = createPrivateKey({ key: pem, format: "pem" })
    return this.cachedKey
  }

  /**
   * Sign a 9-minute JWT identifying our GitHub App. GitHub's hard limit is
   * 10 minutes; we leave a minute of slack and backdate `iat` 60s for clock
   * skew.
   */
  private async signAppJwt(): Promise<string> {
    const key = this.getPrivateKey()
    const now = Math.floor(Date.now() / 1000)
    return await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 540)
      .setIssuer(this.config.appId)
      .sign(key)
  }

  /**
   * Exchange the App JWT for a 1-hour installation access token. This token is
   * what the agent's tool calls actually use against api.githubcopilot.com.
   */
  private async mintInstallationToken(
    installationId: string
  ): Promise<InstallationToken> {
    const jwt = await this.signAppJwt()
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
}
