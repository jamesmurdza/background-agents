/**
 * /api/mcp/gmail
 *
 * Our Gmail MCP server (Streamable HTTP, stateless). The agent authenticates
 * with a connection token from the Gmail provider; we load that connection's
 * tool policy and its owner's Google refresh token on every request, so a
 * policy change or disconnect takes effect on the next call.
 */

import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import { serverConfigError, unauthorized } from "@/lib/db/api-helpers"
import { GMAIL_CONFIG_VARS, getGmailProvider } from "@/lib/mcp/gmail"
import { GMAIL_CREDENTIAL } from "@/lib/mcp/credentials"
import {
  GMAIL_MCP_QUALIFIED_NAME,
  parseGmailToolPolicy,
  serveGmailMcp,
} from "@background-agents/mcp"

const ownerUserSelect = {
  select: {
    user: {
      select: {
        id: true,
        mcpCredentials: {
          where: { provider: GMAIL_CREDENTIAL },
          select: { refreshTokenEncrypted: true },
        },
      },
    },
  },
}

async function handle(req: Request): Promise<Response> {
  const provider = getGmailProvider()
  if (!provider) return serverConfigError(GMAIL_CONFIG_VARS)

  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]
  const connectionId = bearer ? await provider.verifyConnectionToken(bearer) : null
  if (!connectionId) return unauthorized()

  const row = await prisma.mcpServerConnection.findUnique({
    where: { id: connectionId },
    select: {
      qualifiedName: true,
      status: true,
      toolPolicy: true,
      chat: ownerUserSelect,
      scheduledJob: ownerUserSelect,
    },
  })
  // A deleted or disconnected row revokes the token even before it expires.
  if (
    !row ||
    row.qualifiedName !== GMAIL_MCP_QUALIFIED_NAME ||
    row.status !== "connected"
  ) {
    return unauthorized()
  }

  const user = row.chat?.user ?? row.scheduledJob?.user
  const encryptedRefreshToken = user?.mcpCredentials[0]?.refreshTokenEncrypted
  if (!user || !encryptedRefreshToken) {
    return Response.json(
      { error: "Gmail not connected for this user" },
      { status: 409 }
    )
  }

  return serveGmailMcp(req, {
    policy: parseGmailToolPolicy(row.toolPolicy),
    getAccessToken: () =>
      provider.getAccessToken(user.id, decrypt(encryptedRefreshToken)),
  })
}

export { handle as GET, handle as POST, handle as DELETE }
