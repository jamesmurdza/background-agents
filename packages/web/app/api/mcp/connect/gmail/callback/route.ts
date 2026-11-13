/**
 * GET /api/mcp/connect/gmail/callback
 *
 * Where Google redirects after consent. We check that `state` was issued to
 * the signed-in user (so nobody can link their mailbox to someone else's
 * account), exchange the code for a refresh token, store it encrypted, and
 * return a page that closes the popup.
 */

import { NextRequest } from "next/server"
import { encrypt } from "@/lib/db/encryption"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { GMAIL_CREDENTIAL, saveMcpCredential } from "@/lib/mcp/credentials"
import { getGmailProvider, getGmailRedirectUri } from "@/lib/mcp/gmail"
import { popupClosingPage } from "@/lib/mcp/popup-page"

function closingPage(opts: { ok: boolean; message: string }): Response {
  return popupClosingPage({ source: "gmail-oauth", provider: "Gmail", ...opts })
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) {
    return closingPage({ ok: false, message: "You must be signed in to finish Gmail setup." })
  }
  const provider = getGmailProvider()
  if (!provider) {
    return closingPage({ ok: false, message: "Gmail is not configured on this server." })
  }

  const params = new URL(req.url).searchParams
  const code = params.get("code")
  const state = params.get("state")
  if (params.get("error") || !code || !state) {
    return closingPage({ ok: false, message: "Google access was not granted." })
  }
  if ((await provider.verifyOAuthState(state)) !== auth.userId) {
    return closingPage({ ok: false, message: "This sign-in link expired. Please try again." })
  }

  try {
    const refreshToken = await provider.exchangeCode(code, getGmailRedirectUri())
    // A fresh grant replaces any older one; drop the old cached access token.
    provider.invalidateAccessToken(auth.userId)
    await saveMcpCredential(auth.userId, GMAIL_CREDENTIAL, {
      refreshTokenEncrypted: encrypt(refreshToken),
    })
    return closingPage({ ok: true, message: "Gmail connected. You can return to the app." })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[gmail-callback] failed for user ${auth.userId}: ${msg}`)
    return closingPage({ ok: false, message: "Gmail setup failed. Please try again." })
  }
}
