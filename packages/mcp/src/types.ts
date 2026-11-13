/**
 * Shared types for MCP providers.
 */

/**
 * Configuration for an MCP server that an agent can connect to.
 * This is the common output format that all providers produce.
 */
export interface McpServerConfig {
  /** Stable identifier for the config entry. Must be unique within the agent's config file. */
  name: string
  /** Remote MCP endpoint the agent CLI should call. */
  url: string
  /** Bearer token to send as `Authorization: Bearer <token>`. */
  bearerToken: string
}

/**
 * Base interface for MCP providers.
 *
 * Each provider knows how to generate tokens/credentials for its MCP endpoint.
 * The web app orchestrates between providers and the database.
 */
export interface IMcpProvider {
  /** Unique identifier for this provider (e.g., "github/github"). */
  readonly qualifiedName: string

  /** Human-readable display name (e.g., "GitHub"). */
  readonly displayName: string

  /** The MCP endpoint URL for this provider. */
  readonly mcpUrl: string
}

/**
 * Provider that uses short-lived tokens that need to be minted on each use.
 * Example: GitHub App installation tokens (1-hour lifetime).
 */
export interface ITokenMintingProvider extends IMcpProvider {
  /**
   * Mint a fresh token for the given installation/connection.
   * Implementations should handle caching internally.
   */
  getToken(installationId: string): Promise<string>

  /**
   * Invalidate a cached token (e.g., after disconnect).
   */
  invalidateToken(installationId: string): void
}

/** Sanitize slugs into a name acceptable to every agent CLI. */
export function safeServerName(qualifiedName: string): string {
  return qualifiedName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
}
