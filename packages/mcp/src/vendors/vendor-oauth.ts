/**
 * The vendor login flow in four calls: register a client, send the user to
 * the consent page, handle the callback, refresh. Wraps the functions in
 * ./oauth and keeps each vendor's OAuth metadata for an hour. See the package
 * README for a full example.
 */

import {
  buildAuthorizationUrl,
  createPkcePair,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  McpOAuthError,
  refreshAccessToken,
  registerOAuthClient,
  signOAuthState,
  verifyOAuthState,
  type OAuthClient,
  type OAuthServerMetadata,
  type OAuthTokens,
} from "./oauth"
import type { McpVendor } from "./list"

export interface VendorOAuthOptions {
  /** Shown on the vendor's consent screen. */
  clientName: string
  /** Your app's home page, sent when registering a client. */
  clientUri?: string
  /** Encrypts the OAuth `state`. Any random 32+ byte string. */
  stateSecret: string
  /** How long to reuse a vendor's OAuth metadata. Defaults to one hour. */
  metadataTtlMs?: number
  fetch?: typeof fetch
}

export interface VendorOAuth {
  /** Register a client with the vendor. Do it once per redirect URI and save the result. */
  registerClient(vendor: McpVendor, options: { redirectUri: string }): Promise<OAuthClient>
  /** The vendor's consent URL for this user, with PKCE and an encrypted `state`. */
  authorizationUrl(
    vendor: McpVendor,
    client: OAuthClient,
    options: { redirectUri: string; userId: string }
  ): Promise<string>
  /**
   * Check the `state` and exchange the `code`. Returns the user id the login
   * was started for. Throws `McpOAuthError` with code "invalid_state" for a
   * forged or expired state, or one issued for another vendor.
   */
  handleCallback(
    vendor: McpVendor,
    client: OAuthClient,
    options: { redirectUri: string; code: string; state: string }
  ): Promise<{ userId: string; tokens: OAuthTokens }>
  /** New tokens. Store the returned refresh token: vendors rotate it. */
  refresh(vendor: McpVendor, client: OAuthClient, refreshToken: string): Promise<OAuthTokens>
}

const DEFAULT_METADATA_TTL_MS = 60 * 60 * 1000

export function createVendorOAuth(options: VendorOAuthOptions): VendorOAuth {
  const fetchImpl = options.fetch ?? fetch
  const ttl = options.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS
  const cache = new Map<string, { metadata: Promise<OAuthServerMetadata>; fetchedAt: number }>()

  function metadataFor(vendor: McpVendor): Promise<OAuthServerMetadata> {
    const hit = cache.get(vendor.slug)
    if (hit && Date.now() - hit.fetchedAt < ttl) return hit.metadata
    const metadata = discoverOAuthMetadata(vendor.mcpUrl, fetchImpl)
    cache.set(vendor.slug, { metadata, fetchedAt: Date.now() })
    // Don't keep a failed lookup around; the next call tries again.
    metadata.catch(() => cache.delete(vendor.slug))
    return metadata
  }

  return {
    async registerClient(vendor, { redirectUri }) {
      return registerOAuthClient(
        await metadataFor(vendor),
        { clientName: options.clientName, clientUri: options.clientUri, redirectUri },
        fetchImpl
      )
    },

    async authorizationUrl(vendor, client, { redirectUri, userId }) {
      const { codeVerifier, codeChallenge } = createPkcePair()
      const state = await signOAuthState(options.stateSecret, {
        userId,
        vendor: vendor.slug,
        codeVerifier,
      })
      return buildAuthorizationUrl(await metadataFor(vendor), client, {
        redirectUri,
        state,
        codeChallenge,
      })
    },

    async handleCallback(vendor, client, { redirectUri, code, state }) {
      const claims = await verifyOAuthState(options.stateSecret, state)
      if (!claims || claims.vendor !== vendor.slug) {
        throw new McpOAuthError("The login link is invalid or expired", "invalid_state")
      }
      const tokens = await exchangeAuthorizationCode(
        await metadataFor(vendor),
        client,
        { code, redirectUri, codeVerifier: claims.codeVerifier },
        fetchImpl
      )
      return { userId: claims.userId, tokens }
    },

    async refresh(vendor, client, refreshToken) {
      return refreshAccessToken(await metadataFor(vendor), client, refreshToken, fetchImpl)
    },
  }
}
