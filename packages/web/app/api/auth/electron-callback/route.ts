import { NextRequest, NextResponse } from "next/server"

/**
 * Electron OAuth Callback Handler
 *
 * After GitHub OAuth completes, if the request came from Electron (has electron=true param),
 * this endpoint redirects to the custom protocol to bring focus back to the Electron app.
 *
 * Flow:
 * 1. Electron intercepts /api/auth/signin and opens in browser with ?electron=true
 * 2. User completes GitHub OAuth in browser
 * 3. NextAuth callback sets session cookies
 * 4. Frontend detects electron param and redirects here
 * 5. This route redirects to background-agents://auth-callback
 * 6. Electron catches the deep link and reloads to pick up the session
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const callbackUrl = searchParams.get("callbackUrl") || "/"

  // Redirect to Electron app via custom protocol
  const electronUrl = `background-agents://auth-callback?success=true&callbackUrl=${encodeURIComponent(callbackUrl)}`

  return NextResponse.redirect(electronUrl)
}
