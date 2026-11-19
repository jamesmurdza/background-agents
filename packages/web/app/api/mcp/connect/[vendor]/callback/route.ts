/**
 * GET /api/mcp/connect/<vendor>/callback
 *
 * Where the vendor redirects after consent. We check that `state` was issued
 * to the signed-in user for this vendor, exchange the code (with the PKCE
 * verifier the state carries), store the tokens encrypted, and return a page
 * that closes the popup.
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { findMcpVendor } from "@background-agents/mcp"
import { finishVendorConnect } from "@/lib/mcp/vendors"
import { popupClosingPage } from "@/lib/mcp/popup-page"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ vendor: string }> }
): Promise<Response> {
  const { vendor: slug } = await params
  const vendor = findMcpVendor(slug)
  if (!vendor) {
    return popupClosingPage({ source: `${slug}-oauth`, provider: slug, ok: false, message: "Unknown integration." })
  }
  const page = (ok: boolean, message: string) =>
    popupClosingPage({ source: `${vendor.slug}-oauth`, provider: vendor.name, ok, message })

  const auth = await requireAuth()
  if (isAuthError(auth)) return page(false, `You must be signed in to finish ${vendor.name} setup.`)

  const search = new URL(req.url).searchParams
  const code = search.get("code")
  const state = search.get("state")
  if (search.get("error") || !code || !state) {
    return page(false, `${vendor.name} access was not granted.`)
  }

  try {
    const ok = await finishVendorConnect(auth.userId, vendor, { code, state })
    if (!ok) return page(false, "This sign-in link expired. Please try again.")
    return page(true, `${vendor.name} connected. You can return to the app.`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[mcp-connect] ${vendor.slug} callback failed for user ${auth.userId}: ${msg}`)
    return page(false, `${vendor.name} setup failed. Please try again.`)
  }
}
