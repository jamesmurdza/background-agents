/**
 * Vendor-hosted MCP servers (Linear, Notion, Sentry, ...) for the web app.
 *
 * - One OAuth client per vendor + redirect URI, registered the first time
 *   anyone connects and shared by every user (McpOAuthClient).
 * - Each user's tokens in McpCredential, keyed by the vendor's slug.
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
  createVendorOAuth,
  McpOAuthError,
  vendorQualifiedName,
  type ClientAuthMethod,
  type McpVendor,
  type OAuthClient,
  type VendorOAuth,
} from "@background-agents/mcp"
import { deleteMcpCredential, findMcpCredential, saveMcpCredential } from "./credentials"

/** For serverConfigError when the state secret isn't set. */
export const MCP_OAUTH_CONFIG_VARS = "MCP_OAUTH_STATE_SECRET"

/** Name shown on the vendor's consent screen. */
const CLIENT_NAME = "Backgrounder"
/** Matches the GitHub provider: refresh 5 minutes before expiry. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000
/** How long one run may hold the refresh; longer than a token request can take. */
const REFRESH_LOCK_MS = 30_000
const WAIT_STEP_MS = 500
const MAX_WAIT_MS = 15_000

export function isVendorOAuthConfigured(): boolean {
  return !!process.env.MCP_OAUTH_STATE_SECRET
}

function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:4000").replace(/\/$/, "")
}

export function vendorRedirectUri(vendor: McpVendor): string {
  return `${appBaseUrl()}/api/mcp/connect/${vendor.slug}/callback`
}

// One per process, so each vendor's OAuth metadata is looked up once an hour
// rather than on every refresh.
let vendorOAuth: VendorOAuth | null = null

function getVendorOAuth(): VendorOAuth {
  const stateSecret = process.env.MCP_OAUTH_STATE_SECRET
  if (!stateSecret) throw new Error(`${MCP_OAUTH_CONFIG_VARS} is not set`)
  vendorOAuth ??= createVendorOAuth({ clientName: CLIENT_NAME, clientUri: appBaseUrl(), stateSecret })
  return vendorOAuth
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

async function getOrRegisterClient(vendor: McpVendor): Promise<OAuthClient> {
  const existing = await prisma.mcpOAuthClient.findUnique({ where: clientWhere(vendor) })
  if (existing) return toOAuthClient(existing)

  const client = await getVendorOAuth().registerClient(vendor, { redirectUri: vendorRedirectUri(vendor) })
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
 * so the next connect registers a new one. Its users' credentials go with it
 * (cascade): those grants were issued to the dead client and can't be used.
 */
async function forgetRejectedClient(error: unknown, clientRowId: string): Promise<void> {
  if (error instanceof McpOAuthError && error.code === "invalid_client") {
    await prisma.mcpOAuthClient.deleteMany({ where: { id: clientRowId } })
  }
}

export async function isVendorConnected(userId: string, vendor: McpVendor): Promise<boolean> {
  return !!(await findMcpCredential(userId, vendor.slug))
}

/** The vendor's consent URL for this user. Registers our client if needed. */
export async function startVendorConnect(userId: string, vendor: McpVendor): Promise<string> {
  const client = await getOrRegisterClient(vendor)
  return getVendorOAuth().authorizationUrl(vendor, client, {
    redirectUri: vendorRedirectUri(vendor),
    userId,
  })
}

/**
 * Finish the callback: exchange the code and store the tokens, if the state
 * was issued to this user for this vendor. Returns false for a bad or
 * expired state.
 */
export async function finishVendorConnect(
  userId: string,
  vendor: McpVendor,
  { code, state }: { code: string; state: string }
): Promise<boolean> {
  const clientRow = await prisma.mcpOAuthClient.findUnique({ where: clientWhere(vendor) })
  if (!clientRow) throw new Error(`No ${vendor.name} OAuth client is registered`)

  let result
  try {
    result = await getVendorOAuth().handleCallback(vendor, toOAuthClient(clientRow), {
      redirectUri: vendorRedirectUri(vendor),
      code,
      state,
    })
  } catch (error) {
    if (error instanceof McpOAuthError && error.code === "invalid_state") return false
    await forgetRejectedClient(error, clientRow.id)
    throw error
  }
  // A login started by someone else (e.g. a link they sent): don't store it.
  if (result.userId !== userId) return false

  const { tokens } = result
  await saveMcpCredential(userId, vendor.slug, {
    clientId: clientRow.id,
    refreshTokenEncrypted: encrypt(tokens.refreshToken),
    accessTokenEncrypted: encrypt(tokens.accessToken),
    accessTokenExpiresAt: new Date(tokens.expiresAt),
    refreshLockedUntil: null,
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
 * jobs. We don't call the vendor: dropping our copy is what cuts off access,
 * and the user can revoke the app on the vendor's side too.
 */
export async function disconnectVendor(userId: string, vendor: McpVendor): Promise<void> {
  await deleteMcpCredential(userId, vendor.slug)
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
    const row = await prisma.mcpCredential.findUnique({
      where: { userId_provider: { userId, provider: vendor.slug } },
      include: { client: true },
    })
    if (!row?.refreshTokenEncrypted || !row.client) {
      throw new Error(`${vendor.name} account not connected for this user`)
    }

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
    const claimed = await prisma.mcpCredential.updateMany({
      where: {
        id: row.id,
        refreshTokenEncrypted: row.refreshTokenEncrypted,
        OR: [{ refreshLockedUntil: null }, { refreshLockedUntil: { lt: now } }],
      },
      data: { refreshLockedUntil: new Date(now.getTime() + REFRESH_LOCK_MS) },
    })
    if (claimed.count === 1) {
      return await refreshClaimedToken(
        { id: row.id, refreshTokenEncrypted: row.refreshTokenEncrypted, client: row.client },
        vendor
      )
    }

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
    const tokens = await getVendorOAuth().refresh(
      vendor,
      toOAuthClient(row.client),
      decrypt(row.refreshTokenEncrypted)
    )
    await prisma.mcpCredential.update({
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
      await prisma.mcpCredential.deleteMany({ where: { id: row.id } })
      throw new Error(`${vendor.name} access was revoked or expired. Reconnect it in Settings → Integrations.`)
    }
    await prisma.mcpCredential
      .updateMany({ where: { id: row.id }, data: { refreshLockedUntil: null } })
      .catch(() => {})
    await forgetRejectedClient(error, row.client.id)
    throw error
  }
}
