/**
 * GET /api/mcp/connect/github/callback
 *
 * Where GitHub redirects after the user installs (or re-configures) our App.
 * We store `installation_id` as the user's GitHub credential and return a tiny HTML page that
 * closes the popup. The parent window polls /api/mcp/connect/github so it
 * notices the connected state on its own.
 *
 * Query params from GitHub:
 *   - installation_id  the installation we'll use for this user
 *   - setup_action     "install" | "update"
 *   - code, state      OAuth bits we don't use
 */

import { NextRequest } from "next/server"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { GITHUB_CREDENTIAL, saveMcpCredential } from "@/lib/mcp/credentials"
import { popupClosingPage } from "@/lib/mcp/popup-page"

function closingPage(opts: { ok: boolean; message: string }): Response {
  return popupClosingPage({ source: "github-app-install", provider: "GitHub", ...opts })
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) {
    return closingPage({
      ok: false,
      message: "You must be signed in to finish GitHub setup.",
    })
  }
  const { userId } = auth

  const installationId = new URL(req.url).searchParams.get("installation_id")
  if (!installationId) {
    return closingPage({
      ok: false,
      message: "GitHub did not return an installation id. Please try again.",
    })
  }

  try {
    await saveMcpCredential(userId, GITHUB_CREDENTIAL, { installationId })
    return closingPage({
      ok: true,
      message: "GitHub connected. You can return to the app.",
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-callback] failed for user ${userId}: ${msg}`)
    return closingPage({ ok: false, message: `GitHub setup failed: ${msg}` })
  }
}
