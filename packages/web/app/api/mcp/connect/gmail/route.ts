/**
 * /api/mcp/connect/gmail
 *
 * Manages the user's Google account link for the Gmail MCP server. Consent
 * happens on accounts.google.com and finishes in /api/mcp/connect/gmail/callback.
 *
 * GET    →  is a Google account linked? + the consent URL the popup should
 *           open if not.
 * DELETE →  revoke the grant at Google, clear the stored refresh token, and
 *           drop every Gmail MCP row across the user's chats and jobs.
 */

import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import { requireAuth, isAuthError, internalError, serverConfigError } from "@/lib/db/api-helpers"
import { GMAIL_CONFIG_VARS, getGmailProvider, getGmailRedirectUri } from "@/lib/mcp/gmail"
import { GMAIL_MCP_QUALIFIED_NAME } from "@background-agents/mcp"
import {
  deleteMcpCredential,
  findMcpCredential,
  GMAIL_CREDENTIAL,
} from "@/lib/mcp/credentials"

export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const provider = getGmailProvider()
  if (!provider) return serverConfigError(GMAIL_CONFIG_VARS)

  try {
    if (await findMcpCredential(auth.userId, GMAIL_CREDENTIAL)) {
      return Response.json({ connected: true })
    }
    const state = await provider.signOAuthState(auth.userId)
    return Response.json({
      connected: false,
      authUrl: provider.getAuthUrl(getGmailRedirectUri(), state),
    })
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const provider = getGmailProvider()
  if (!provider) return serverConfigError(GMAIL_CONFIG_VARS)

  const { userId } = auth
  try {
    const credential = await findMcpCredential(userId, GMAIL_CREDENTIAL)
    if (credential?.refreshTokenEncrypted) {
      try {
        await provider.revokeToken(decrypt(credential.refreshTokenEncrypted))
      } catch (err) {
        // The grant may already be revoked on Google's side; clearing our copy
        // below still cuts off access, so continue.
        console.warn("[gmail-connect] Google token revoke failed:", err)
      }
      provider.invalidateAccessToken(userId)
    }

    await deleteMcpCredential(userId, GMAIL_CREDENTIAL)
    await prisma.mcpServerConnection.deleteMany({
      where: {
        qualifiedName: GMAIL_MCP_QUALIFIED_NAME,
        OR: [{ chat: { userId } }, { scheduledJob: { userId } }],
      },
    })
    return Response.json({ disconnected: true })
  } catch (error) {
    return internalError(error)
  }
}
