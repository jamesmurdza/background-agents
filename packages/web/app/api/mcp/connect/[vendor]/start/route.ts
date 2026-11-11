/**
 * GET /api/mcp/connect/<vendor>/start
 *
 * Opened in the connect popup. Registers our OAuth client with the vendor the
 * first time anyone connects, then redirects to the vendor's consent page.
 */

import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { findMcpVendor } from "@background-agents/mcp"
import { startVendorConnect } from "@/lib/mcp/vendors"
import { popupClosingPage } from "@/lib/mcp/popup-page"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ vendor: string }> }
): Promise<Response> {
  const { vendor: slug } = await params
  const vendor = findMcpVendor(slug)
  if (!vendor) {
    return popupClosingPage({ source: `${slug}-oauth`, provider: slug, ok: false, message: "Unknown integration." })
  }
  const fail = (message: string) =>
    popupClosingPage({ source: `${vendor.slug}-oauth`, provider: vendor.name, ok: false, message })

  const auth = await requireAuth()
  if (isAuthError(auth)) return fail(`You must be signed in to connect ${vendor.name}.`)

  try {
    return Response.redirect(await startVendorConnect(auth.userId, vendor), 302)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[mcp-connect] ${vendor.slug} start failed for user ${auth.userId}: ${msg}`)
    return fail(`Couldn't start ${vendor.name} setup. Please try again.`)
  }
}
