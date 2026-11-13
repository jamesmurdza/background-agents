/**
 * @background-agents/mcp
 *
 * Gives a coding agent access to MCP servers on behalf of your users:
 *
 * - **Vendor servers**: Linear, Notion, Sentry and other vendors host their
 *   own MCP server. `createVendorOAuth` logs the user in with OAuth (dynamic
 *   client registration, PKCE) and refreshes their token.
 *
 * - **GitHub**: Uses GitHub App authentication to mint short-lived installation
 *   tokens for GitHub's hosted MCP server (api.githubcopilot.com/mcp/).
 *
 * - **Gmail**: An MCP server you host that enforces a per-connection tool
 *   policy in front of the Gmail API.
 *
 * Storage is left to the caller. See the README for examples.
 */

// Types
export type { McpServerConfig, IMcpProvider, ITokenMintingProvider } from "./types"
export { safeServerName } from "./types"

// GitHub provider
export {
  createGitHubMcpProvider,
  GitHubMcpProvider,
  type GitHubMcpConfig,
  GITHUB_MCP_URL,
  GITHUB_MCP_QUALIFIED_NAME,
} from "./github"

// Vendor-hosted MCP servers over OAuth
export {
  MCP_VENDORS,
  type McpVendor,
  vendorQualifiedName,
  findMcpVendor,
  findMcpVendorByQualifiedName,
  createVendorOAuth,
  type VendorOAuth,
  type VendorOAuthOptions,
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
