/**
 * GitHub MCP constants.
 */

/**
 * GitHub's hosted MCP server. Accepts `Authorization: Bearer <installation-
 * token>` and exposes issues, PRs, repos, code search, etc.
 */
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"

/**
 * Sentinel qualifiedName we use for the GitHub MCP row in ChatMcpServer.
 * This distinguishes GitHub rows from Smithery rows.
 */
export const GITHUB_MCP_QUALIFIED_NAME = "github/github"
