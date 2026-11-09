/**
 * Paddle MCP constants.
 */

/**
 * Paddle's hosted MCP server (live). Accepts `Authorization: Bearer
 * <access-token>` and exposes billing/subscription/customer tools.
 * See https://developer.paddle.com/sdks/ai/paddle-mcp/
 */
export const PADDLE_MCP_URL = "https://mcp.paddle.com/mcp"

/**
 * Paddle's OAuth authorization server (discovered via
 * https://mcp.paddle.com/.well-known/oauth-authorization-server). Hardcoded
 * here rather than fetched at runtime since it's not expected to change and
 * we don't want a network round-trip on every provider construction.
 */
export const PADDLE_OAUTH_AUTHORIZE_URL = "https://id.paddle.com/oauth2/authorize"
export const PADDLE_OAUTH_TOKEN_URL = "https://id.paddle.com/oauth2/token"

/**
 * The RFC 8707 `resource` identifier for Paddle's MCP server, from
 * https://mcp.paddle.com/.well-known/oauth-protected-resource. id.paddle.com
 * is Paddle's shared identity provider, not dedicated to the MCP server, so
 * every authorize/token request MUST carry this — otherwise Paddle mints a
 * generic identity token with no audience for mcp.paddle.com, and the MCP
 * server rejects it with 401 "Invalid bearer token."
 */
export const PADDLE_MCP_RESOURCE = "https://mcp.paddle.com"

/**
 * `offline_access` is what makes Paddle return a refresh token alongside the
 * access token, so we can mint fresh access tokens per agent turn without
 * re-prompting the user.
 */
export const PADDLE_OAUTH_SCOPE = "offline_access"

/**
 * Sentinel qualifiedName we use for the Paddle MCP row in McpServerConnection.
 */
export const PADDLE_MCP_QUALIFIED_NAME = "paddle/paddle"
