/**
 * @background-agents/mcp
 *
 * MCP provider abstractions for GitHub, Smithery, Gmail, and Paddle.
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
 * - **Gmail**: Our own MCP server (served by the web app) that enforces a
 *   per-connection tool policy in front of the Gmail API.
 *
 * - **Paddle**: Uses OAuth (authorization_code + PKCE) against Paddle's own
 *   authorization server to mint access tokens for Paddle's hosted MCP
 *   server (mcp.paddle.com/mcp).
 *
 * - **Vendors**: The same OAuth flow, generalized: a list of vendors that host
 *   their own MCP server (Linear, Notion, Sentry, ...) and plain functions to
 *   discover their OAuth metadata, register a client, log in and refresh.
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

// Paddle provider
export {
  createPaddleMcpProvider,
  PaddleMcpProvider,
  type PaddleMcpConfig,
  PADDLE_MCP_URL,
  PADDLE_MCP_QUALIFIED_NAME,
} from "./paddle"

// Vendor-hosted MCP servers over OAuth
export {
  MCP_VENDORS,
  type McpVendor,
  vendorQualifiedName,
  findMcpVendor,
  findMcpVendorByQualifiedName,
  discoverOAuthMetadata,
  pickClientAuthMethod,
  registerOAuthClient,
  createPkcePair,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  signOAuthState,
  verifyOAuthState,
  McpOAuthError,
  type OAuthServerMetadata,
  type ClientAuthMethod,
  type OAuthClient,
  type OAuthTokens,
  type OAuthStateClaims,
} from "./vendors"

// Gmail provider
export {
  GMAIL_MCP_QUALIFIED_NAME,
  GMAIL_TOOL_NAMES,
  type GmailToolName,
  gmailToolPolicySchema,
  type GmailToolPolicy,
  GMAIL_POLICY_PRESETS,
  DEFAULT_GMAIL_POLICY,
  parseGmailToolPolicy,
  createGmailMcpProvider,
  GmailMcpProvider,
  type GmailMcpConfig,
  serveGmailMcp,
  type ServeGmailMcpOptions,
} from "./gmail"
