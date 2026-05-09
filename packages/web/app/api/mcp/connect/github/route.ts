/**
 * /api/mcp/connect/github
 *
 * Manages the GitHub-App-backed MCP connection for the signed-in user.
 *
 * GET / POST   →   tells the client whether the App is installed for this
 *                  user, and if not, returns the install URL the popup
 *                  should open. The actual install happens on github.com
 *                  and finishes in /api/mcp/connect/github/callback.
 *
 * DELETE       →   tear down: clear our installationId and delete the
 *                  Smithery connection. Does NOT uninstall the App from the
 *                  user's account — that's a user-initiated action on
 *                  github.com that we deliberately don't try to fake.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  internalError,
  serverConfigError,
} from "@/lib/db/api-helpers"
import {
  getSmithery,
  githubConnectionIdFor,
  SMITHERY_NAMESPACE,
} from "@/lib/mcp/smithery-client"
import {
  getInstallUrl,
  invalidateInstallationToken,
} from "@/lib/github/app"

interface ConnectResponse {
  /** True iff the user has installed our GitHub App. */
  connected: boolean
  /** The URL to open in a popup when not connected. */
  installUrl?: string
}

function requireConfig(): Response | null {
  if (!process.env.SMITHERY_API_KEY) return serverConfigError("SMITHERY_API_KEY")
  if (!process.env.GITHUB_APP_ID) return serverConfigError("GITHUB_APP_ID")
  if (!process.env.GITHUB_APP_SLUG) return serverConfigError("GITHUB_APP_SLUG")
  if (!process.env.GITHUB_APP_PRIVATE_KEY)
    return serverConfigError("GITHUB_APP_PRIVATE_KEY")
  return null
}

async function getStatus(userId: string): Promise<ConnectResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })
  if (user?.githubAppInstallationId) {
    return { connected: true }
  }
  return { connected: false, installUrl: getInstallUrl() }
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

export async function POST(_req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const cfgErr = requireConfig()
  if (cfgErr) return cfgErr

  // Same shape as GET — kept for symmetry with the existing modal code that
  // POSTs to "kick off" the flow. The actual kickoff is the user opening
  // installUrl in a popup; we have nothing to mutate here.
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

  // Drop the cached installation token before we lose the id. Otherwise a
  // stale token could linger in this process's cache and be used against the
  // (now-stale) Smithery connection if the user re-installs immediately.
  if (user?.githubAppInstallationId) {
    invalidateInstallationToken(user.githubAppInstallationId)
  }

  // Delete the Smithery connection. 404 is fine — it just means we never
  // succeeded in creating one (e.g. callback errored out).
  const smithery = getSmithery()
  const connectionId = githubConnectionIdFor(userId)
  try {
    await smithery.connections.delete(connectionId, {
      namespace: SMITHERY_NAMESPACE,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!/404|not found/i.test(msg)) {
      console.error(`[MCP-connect] DELETE smithery failed: ${msg}`)
      return internalError(error)
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      githubAppInstallationId: null,
      smitheryGithubConnectionId: null,
    },
  })

  console.log(`[MCP-connect] DELETE user=${userId}`)
  return Response.json({ disconnected: true })
}
