/**
 * /api/mcp/connect/<vendor>
 *
 * Manages the user's link to a vendor-hosted MCP server (Linear, Notion, ...,
 * see MCP_VENDORS). Consent happens on the vendor's site: the popup opens
 * ./start, which redirects there, and finishes in ./callback.
 *
 * GET    →  is the vendor linked? + the URL the popup should open if not.
 *           Only reads the DB, so the picker can check every vendor at once
 *           without registering OAuth clients nobody uses.
 * DELETE →  forget the user's tokens and drop the vendor's MCP rows across
 *           their chats and jobs.
 */

import { requireAuth, isAuthError, internalError, notFound, serverConfigError } from "@/lib/db/api-helpers"
import { findMcpVendor } from "@background-agents/mcp"
import {
  MCP_OAUTH_CONFIG_VARS,
  disconnectVendor,
  isVendorConnected,
  isVendorOAuthConfigured,
} from "@/lib/mcp/vendors"

type Params = { params: Promise<{ vendor: string }> }

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { vendor: slug } = await params
  const vendor = findMcpVendor(slug)
  if (!vendor) return notFound("Unknown MCP vendor")
  if (!isVendorOAuthConfigured()) return serverConfigError(MCP_OAUTH_CONFIG_VARS)

  try {
    if (await isVendorConnected(auth.userId, vendor)) {
      return Response.json({ connected: true })
    }
    return Response.json({ connected: false, authUrl: `/api/mcp/connect/${vendor.slug}/start` })
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { vendor: slug } = await params
  const vendor = findMcpVendor(slug)
  if (!vendor) return notFound("Unknown MCP vendor")

  try {
    await disconnectVendor(auth.userId, vendor)
    return Response.json({ disconnected: true })
  } catch (error) {
    return internalError(error)
  }
}
