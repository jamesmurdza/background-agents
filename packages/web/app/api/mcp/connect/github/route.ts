/**
 * /api/mcp/connect/github
 *
 * Manages the user's GitHub App installation. The install itself happens on
 * github.com and finishes in /api/mcp/connect/github/callback.
 *
 * GET   →   is the App installed for this user? + the install URL the popup
 *           should open if not.
 * DELETE →  clear our recorded installationId. Does NOT uninstall the App
 *           from the user's GitHub account — that's a user-initiated action
 *           on github.com.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  internalError,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { createGitHubMcpProvider } from "@upstream/mcp-providers"

interface ConnectResponse {
  /** True iff the user has installed our GitHub App. */
  connected: boolean
  /** The URL to open in a popup when not connected. */
  installUrl?: string
  /** Present iff connected — used to build the github.com management URL. */
  installationId?: string
}

function getGitHubConfig() {
  const appId = process.env.GITHUB_APP_ID
  const appSlug = process.env.GITHUB_APP_SLUG
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !appSlug || !privateKey) {
    return null
  }

  return { appId, appSlug, privateKey }
}

function requireConfig(): Response | null {
  if (!process.env.GITHUB_APP_ID) return serverConfigError("GITHUB_APP_ID")
  if (!process.env.GITHUB_APP_SLUG) return serverConfigError("GITHUB_APP_SLUG")
  if (!process.env.GITHUB_APP_PRIVATE_KEY) {
    return serverConfigError("GITHUB_APP_PRIVATE_KEY")
  }
  return null
}

async function getStatus(userId: string): Promise<ConnectResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })
  if (user?.githubAppInstallationId) {
    return { connected: true, installationId: user.githubAppInstallationId }
  }

  const config = getGitHubConfig()
  if (!config) {
    return { connected: false }
  }

  const provider = createGitHubMcpProvider(config)
  return { connected: false, installUrl: provider.getInstallUrl() }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const cfgErr = requireConfig()
  if (cfgErr) return cfgErr

  try {
    return Response.json(await getStatus(auth.userId))
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(_req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const cfgErr = requireConfig()
  if (cfgErr) return cfgErr

  const { userId } = auth
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })

  // Drop the cached installation token before clearing the id; otherwise a
  // re-install with the same installation id could briefly hit the stale
  // cached token.
  if (user?.githubAppInstallationId) {
    const config = getGitHubConfig()
    if (config) {
      const provider = createGitHubMcpProvider(config)
      provider.invalidateToken(user.githubAppInstallationId)
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { githubAppInstallationId: null },
  })

  // Also drop any GitHub MCP rows that point at this user's resources (chats
  // or scheduled jobs), so the picker stops showing GitHub as connected and a
  // scheduled run days later doesn't try to use a dead installation id.
  await prisma.mcpServerConnection.deleteMany({
    where: {
      qualifiedName: "github/github",
      OR: [
        { chat: { userId } },
        { scheduledJob: { userId } },
      ],
    },
  })

  return Response.json({ disconnected: true })
}
