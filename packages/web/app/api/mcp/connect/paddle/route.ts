/**
 * /api/mcp/connect/paddle
 *
 * Manages the user's Paddle account link for Paddle's hosted MCP server.
 * Consent happens on id.paddle.com and finishes in
 * /api/mcp/connect/paddle/callback.
 *
 * GET    →  is a Paddle account linked? + the consent URL the popup should
 *           open if not.
 * DELETE →  clear the stored refresh token and drop every Paddle MCP row
 *           across the user's chats and jobs. (Paddle's authorization server
 *           doesn't expose a revocation endpoint, so there's nothing to call
 *           at Paddle — dropping our copy is what actually cuts off access.)
 */

import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, internalError, serverConfigError } from "@/lib/db/api-helpers"
import { PADDLE_CONFIG_VARS, getPaddleProvider, getPaddleRedirectUri } from "@/lib/mcp/paddle"
import { PADDLE_MCP_QUALIFIED_NAME } from "@background-agents/mcp"

export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const provider = getPaddleProvider()
  if (!provider) return serverConfigError(PADDLE_CONFIG_VARS)

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { paddleRefreshTokenEncrypted: true },
    })
    if (user?.paddleRefreshTokenEncrypted) {
      return Response.json({ connected: true })
    }
    const authUrl = await provider.getAuthUrl(getPaddleRedirectUri(), auth.userId)
    return Response.json({ connected: false, authUrl })
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const provider = getPaddleProvider()
  if (!provider) return serverConfigError(PADDLE_CONFIG_VARS)

  const { userId } = auth
  try {
    provider.invalidateToken(userId)
    await prisma.user.update({
      where: { id: userId },
      data: { paddleRefreshTokenEncrypted: null },
    })
    await prisma.mcpServerConnection.deleteMany({
      where: {
        qualifiedName: PADDLE_MCP_QUALIFIED_NAME,
        OR: [{ chat: { userId } }, { scheduledJob: { userId } }],
      },
    })
    return Response.json({ disconnected: true })
  } catch (error) {
    return internalError(error)
  }
}
