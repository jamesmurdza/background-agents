/**
 * Electron Token Generation Endpoint
 *
 * Generates a signed JWT session token for Electron authentication.
 * This endpoint is called after successful OAuth in the system browser.
 * The token is passed to Electron via deep link and set as a session cookie.
 */

import { getServerSession } from "next-auth"
import { encode } from "next-auth/jwt"
import { authOptions } from "@/lib/auth"

export async function POST(): Promise<Response> {
  // Require authenticated session (cookies must work in browser)
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    // Generate JWT session token using NextAuth's encode function
    // This produces the exact same format NextAuth uses for session cookies
    const token = await encode({
      token: {
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })

    return Response.json({ token })
  } catch (error) {
    console.error("[electron-token] Error generating token:", error)
    return Response.json(
      { error: "Failed to generate token" },
      { status: 500 }
    )
  }
}
