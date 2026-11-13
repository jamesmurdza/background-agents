/**
 * Vendor-hosted MCP servers reached directly over OAuth.
 */

export {
  MCP_VENDORS,
  type McpVendor,
  vendorQualifiedName,
  findMcpVendor,
  findMcpVendorByQualifiedName,
} from "./list"
export {
  createVendorOAuth,
  type VendorOAuth,
  type VendorOAuthOptions,
} from "./vendor-oauth"
export {
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
} from "./oauth"
