/**
 * GET /api/mcp/connect/paddle/callback
 *
 * Where Paddle redirects after consent. We check that `state` was issued to
 * the signed-in user (so nobody can link their Paddle account to someone
 * else's), recover the PKCE verifier carried in that same state, exchange
 * the code for a refresh token, store it encrypted, and return a page that
 * closes the popup.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { encrypt } from "@/lib/db/encryption"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { getPaddleProvider, getPaddleRedirectUri } from "@/lib/mcp/paddle"
import { popupClosingPage } from "@/lib/mcp/popup-page"

function closingPage(opts: { ok: boolean; message: string }): Response {
  return popupClosingPage({ source: "paddle-oauth", provider: "Paddle", ...opts })
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) {
    return closingPage({ ok: false, message: "You must be signed in to finish Paddle setup." })
  }
  const provider = getPaddleProvider()
  if (!provider) {
    return closingPage({ ok: false, message: "Paddle is not configured on this server." })
  }

  const params = new URL(req.url).searchParams
  const code = params.get("code")
  const state = params.get("state")
  if (params.get("error") || !code || !state) {
    return closingPage({ ok: false, message: "Paddle access was not granted." })
  }

  const verified = await provider.verifyOAuthState(state)
  if (!verified || verified.userId !== auth.userId) {
    return closingPage({ ok: false, message: "This sign-in link expired. Please try again." })
  }

  try {
    const refreshToken = await provider.exchangeCode(
      code,
      getPaddleRedirectUri(),
      verified.codeVerifier
    )
    // A fresh grant replaces any older one; drop the old cached access token.
    provider.invalidateToken(auth.userId)
    await prisma.user.update({
      where: { id: auth.userId },
      data: { paddleRefreshTokenEncrypted: encrypt(refreshToken) },
    })
    return closingPage({ ok: true, message: "Paddle connected. You can return to the app." })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[paddle-callback] failed for user ${auth.userId}: ${msg}`)
    return closingPage({ ok: false, message: "Paddle setup failed. Please try again." })
  }
}
