/**
 * Vendor-hosted MCP servers (Linear, Notion, Sentry, ...) for the web app.
 *
 * - One OAuth client per vendor + redirect URI, registered the first time
 *   anyone connects and shared by every user (McpOAuthClient).
 * - Each user's tokens in McpOAuthToken.
 * - An access-token getter for agent runs that reuses the stored token while
 *   it's valid and lets only one run refresh at a time, because vendors
 *   rotate refresh tokens: a second refresh with the old one fails, and some
 *   servers revoke the whole grant when they see it.
 *
 * The OAuth protocol itself lives in @background-agents/mcp.
 */
import { prisma } from "@/lib/db/prisma"
import { decrypt, encrypt } from "@/lib/db/encryption"
import {
  buildAuthorizationUrl,
  createPkcePair,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  McpOAuthError,
  refreshAccessToken,
  registerOAuthClient,
  signOAuthState,
  vendorQualifiedName,
  verifyOAuthState,
  type ClientAuthMethod,
  type McpVendor,
  type OAuthClient,
  type OAuthServerMetadata,
} from "@background-agents/mcp"

/** For serverConfigError when the state secret isn't set. */
export const MCP_OAUTH_CONFIG_VARS = "MCP_OAUTH_STATE_SECRET"

/** Name shown on the vendor's consent screen. */
const CLIENT_NAME = "Backgrounder"
/** Matches the Paddle/GitHub providers: refresh 5 minutes before expiry. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000
/** How long one run may hold the refresh; longer than a token request can take. */
const REFRESH_LOCK_MS = 30_000
const WAIT_STEP_MS = 500
const MAX_WAIT_MS = 15_000
const METADATA_TTL_MS = 60 * 60 * 1000

function stateSecret(): string | null {
  return process.env.MCP_OAUTH_STATE_SECRET || null
}

export function isVendorOAuthConfigured(): boolean {
  return stateSecret() !== null
}

function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:4000").replace(/\/$/, "")
}

export function vendorRedirectUri(vendor: McpVendor): string {
  return `${appBaseUrl()}/api/mcp/connect/${vendor.slug}/callback`
}

// OAuth metadata rarely changes, so keep it per process instead of fetching
// it on every refresh.
const metadataCache = new Map<string, { value: OAuthServerMetadata; fetchedAt: number }>()

async function getMetadata(vendor: McpVendor): Promise<OAuthServerMetadata> {
  const cached = metadataCache.get(vendor.slug)
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) return cached.value
  const value = await discoverOAuthMetadata(vendor.mcpUrl)
  metadataCache.set(vendor.slug, { value, fetchedAt: Date.now() })
  return value
}

interface ClientRow {
  id: string
  clientId: string
  clientSecretEncrypted: string | null
  authMethod: string
}

function toOAuthClient(row: ClientRow): OAuthClient {
  return {
    clientId: row.clientId,
    clientSecret: row.clientSecretEncrypted ? decrypt(row.clientSecretEncrypted) : null,
    authMethod: row.authMethod as ClientAuthMethod,
  }
}

function clientWhere(vendor: McpVendor) {
  return { vendor_redirectUri: { vendor: vendor.slug, redirectUri: vendorRedirectUri(vendor) } }
}

async function getOrRegisterClient(vendor: McpVendor, metadata: OAuthServerMetadata): Promise<OAuthClient> {
  const existing = await prisma.mcpOAuthClient.findUnique({ where: clientWhere(vendor) })
  if (existing) return toOAuthClient(existing)

  const client = await registerOAuthClient(metadata, {
    clientName: CLIENT_NAME,
    clientUri: appBaseUrl(),
    redirectUri: vendorRedirectUri(vendor),
  })
  try {
    await prisma.mcpOAuthClient.create({
      data: {
        vendor: vendor.slug,
        redirectUri: vendorRedirectUri(vendor),
        clientId: client.clientId,
        clientSecretEncrypted: client.clientSecret ? encrypt(client.clientSecret) : null,
        authMethod: client.authMethod,
      },
    })
    return client
  } catch (error) {
    // Someone else registered at the same moment; use theirs.
    const raced = await prisma.mcpOAuthClient.findUnique({ where: clientWhere(vendor) })
    if (raced) return toOAuthClient(raced)
    throw error
  }
}

/**
 * The server no longer knows our client (e.g. the vendor deleted it). Drop it
 * so the next connect registers a new one. Its users' tokens go with it
 * (cascade): those grants were issued to the dead client and can't be used.
 */
async function forgetRejectedClient(error: unknown, clientRowId: string): Promise<void> {
  if (error instanceof McpOAuthError && error.code === "invalid_client") {
    await prisma.mcpOAuthClient.deleteMany({ where: { id: clientRowId } })
  }
}

export async function isVendorConnected(userId: string, vendor: McpVendor): Promise<boolean> {
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { userId_vendor: { userId, vendor: vendor.slug } },
    select: { id: true },
  })
  return !!row
}

/** The vendor's consent URL for this user. Registers our client if needed. */
export async function startVendorConnect(userId: string, vendor: McpVendor): Promise<string> {
  const secret = stateSecret()
  if (!secret) throw new Error(`${MCP_OAUTH_CONFIG_VARS} is not set`)
  const metadata = await getMetadata(vendor)
  const client = await getOrRegisterClient(vendor, metadata)
  const { codeVerifier, codeChallenge } = createPkcePair()
  const state = await signOAuthState(secret, { userId, vendor: vendor.slug, codeVerifier })
  return buildAuthorizationUrl(metadata, client, {
    redirectUri: vendorRedirectUri(vendor),
    state,
    codeChallenge,
  })
}

/**
 * Finish the callback: check the state was issued to this user for this
 * vendor, exchange the code and store the tokens. Returns false for a bad or
 * expired state.
 */
export async function finishVendorConnect(
  userId: string,
  vendor: McpVendor,
  { code, state }: { code: string; state: string }
): Promise<boolean> {
  const secret = stateSecret()
  if (!secret) throw new Error(`${MCP_OAUTH_CONFIG_VARS} is not set`)
  const claims = await verifyOAuthState(secret, state)
  if (!claims || claims.userId !== userId || claims.vendor !== vendor.slug) return false

  const clientRow = await prisma.mcpOAuthClient.findUnique({ where: clientWhere(vendor) })
  if (!clientRow) throw new Error(`No ${vendor.name} OAuth client is registered`)
  const metadata = await getMetadata(vendor)

  let tokens
  try {
    tokens = await exchangeAuthorizationCode(metadata, toOAuthClient(clientRow), {
      code,
      redirectUri: vendorRedirectUri(vendor),
      codeVerifier: claims.codeVerifier,
    })
  } catch (error) {
    await forgetRejectedClient(error, clientRow.id)
    throw error
  }

  const data = {
    clientId: clientRow.id,
    refreshTokenEncrypted: encrypt(tokens.refreshToken),
    accessTokenEncrypted: encrypt(tokens.accessToken),
    accessTokenExpiresAt: new Date(tokens.expiresAt),
    refreshLockedUntil: null,
  }
  await prisma.mcpOAuthToken.upsert({
    where: { userId_vendor: { userId, vendor: vendor.slug } },
    create: { userId, vendor: vendor.slug, ...data },
    update: data,
  })
  // Reconnecting after access was revoked: bring back the chats and jobs
  // that were marked as failing, so the user doesn't have to re-attach each.
  await prisma.mcpServerConnection.updateMany({
    where: {
      qualifiedName: vendorQualifiedName(vendor),
      status: "error",
      OR: [{ chat: { userId } }, { scheduledJob: { userId } }],
    },
    data: { status: "connected", lastError: null },
  })
  return true
}

/**
 * Forget the user's tokens and detach the vendor from all of their chats and
 * jobs. Like Paddle, we don't call the vendor: dropping our copy is what cuts
 * off access, and the user can revoke the app on the vendor's side too.
 */
export async function disconnectVendor(userId: string, vendor: McpVendor): Promise<void> {
  await prisma.mcpOAuthToken.deleteMany({ where: { userId, vendor: vendor.slug } })
  await prisma.mcpServerConnection.deleteMany({
    where: {
      qualifiedName: vendorQualifiedName(vendor),
      OR: [{ chat: { userId } }, { scheduledJob: { userId } }],
    },
  })
}

/**
 * An access token for an agent run. Reuses the stored one while it has more
 * than 5 minutes left. Otherwise one run takes a short lock and refreshes;
 * runs that arrive meanwhile wait and read the result, so the vendor never
 * sees the same refresh token twice.
 */
export async function getVendorAccessToken(userId: string, vendor: McpVendor): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS
  for (;;) {
    const row = await prisma.mcpOAuthToken.findUnique({
      where: { userId_vendor: { userId, vendor: vendor.slug } },
      include: { client: true },
    })
    if (!row) throw new Error(`${vendor.name} account not connected for this user`)

    if (
      row.accessTokenEncrypted &&
      row.accessTokenExpiresAt &&
      row.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_BEFORE_MS
    ) {
      return decrypt(row.accessTokenEncrypted)
    }

    // Claim only if no one holds the lock and the row is still the one we
    // read: if another run refreshed in between, its refresh token differs
    // and we loop round to use the access token it stored.
    const now = new Date()
    const claimed = await prisma.mcpOAuthToken.updateMany({
      where: {
        id: row.id,
        refreshTokenEncrypted: row.refreshTokenEncrypted,
        OR: [{ refreshLockedUntil: null }, { refreshLockedUntil: { lt: now } }],
      },
      data: { refreshLockedUntil: new Date(now.getTime() + REFRESH_LOCK_MS) },
    })
    if (claimed.count === 1) return await refreshClaimedToken(row, vendor)

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another ${vendor.name} token refresh`)
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS))
  }
}

async function refreshClaimedToken(
  row: { id: string; refreshTokenEncrypted: string; client: ClientRow },
  vendor: McpVendor
): Promise<string> {
  try {
    const metadata = await getMetadata(vendor)
    const tokens = await refreshAccessToken(
      metadata,
      toOAuthClient(row.client),
      decrypt(row.refreshTokenEncrypted)
    )
    await prisma.mcpOAuthToken.update({
      where: { id: row.id },
      data: {
        refreshTokenEncrypted: encrypt(tokens.refreshToken),
        accessTokenEncrypted: encrypt(tokens.accessToken),
        accessTokenExpiresAt: new Date(tokens.expiresAt),
        refreshLockedUntil: null,
      },
    })
    return tokens.accessToken
  } catch (error) {
    if (error instanceof McpOAuthError && error.code === "invalid_grant") {
      // The user revoked access on the vendor's side, or the grant expired.
      // The refresh token is dead, so forget it: the vendor then shows as not
      // connected, and reconnecting brings the failed rows back.
      await prisma.mcpOAuthToken.deleteMany({ where: { id: row.id } })
      throw new Error(`${vendor.name} access was revoked or expired. Reconnect it in Settings → Integrations.`)
    }
    await prisma.mcpOAuthToken
      .updateMany({ where: { id: row.id }, data: { refreshLockedUntil: null } })
      .catch(() => {})
    await forgetRejectedClient(error, row.client.id)
    throw error
  }
}
