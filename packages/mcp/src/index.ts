/**
 * @background-agents/mcp
 *
 * MCP provider abstractions for GitHub and Smithery.
 *
 * This package provides framework-agnostic implementations for connecting to
 * MCP servers through different providers:
 *
 * - **GitHub**: Uses GitHub App authentication to mint short-lived installation
 *   tokens for GitHub's hosted MCP server (api.githubcopilot.com/mcp/).
 *
 * - **Smithery**: Uses Smithery Connect to manage connections with per-server
 *   OAuth flows.
 *
 * @example
 * ```typescript
 * import {
 *   createGitHubMcpProvider,
 *   createSmitheryProvider,
 * } from "@background-agents/mcp"
 *
 * // GitHub provider - mint installation tokens
 * const github = createGitHubMcpProvider({
 *   appId: process.env.GITHUB_APP_ID!,
 *   appSlug: process.env.GITHUB_APP_SLUG!,
 *   privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
 * })
 * const token = await github.getToken(installationId)
 *
 * // Smithery provider - manage connections
 * const smithery = createSmitheryProvider({
 *   apiKey: process.env.SMITHERY_API_KEY!,
 * })
 * const result = await smithery.createConnection(mcpUrl, connectionId, name)
 * ```
 */

// Types
export type {
  McpServerConfig,
  IMcpProvider,
  ITokenMintingProvider,
  IConnectionProvider,
  ConnectionResult,
  ConnectionStatus,
} from "./types"
export { safeServerName } from "./types"

// GitHub provider
export {
  createGitHubMcpProvider,
  GitHubMcpProvider,
  type GitHubMcpConfig,
  GITHUB_MCP_URL,
  GITHUB_MCP_QUALIFIED_NAME,
} from "./github"

// Smithery provider
export {
  createSmitheryProvider,
  SmitheryProvider,
  getSmitheryConnectionId,
  type SmitheryConfig,
  SMITHERY_API_BASE,
  isSmitheryServer,
} from "./smithery"
