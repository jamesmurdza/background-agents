/**
 * Dev-only endpoint that creates a session for the dev user.
 * This allows the UI to work in dev mode without real OAuth.
 *
 * Only works when GITHUB_PAT is set and NODE_ENV !== "production"
 */

import { cookies, headers } from "next/headers"
import { encode } from "next-auth/jwt"
import { isAuthSkipped, ensureDevUserExists, DEV_USER_ID, DEV_USER } from "@/lib/dev-auth"

export async function GET(request: Request) {
  // Only allow in dev mode
  if (!isAuthSkipped()) {
    return Response.json({ error: "Not available" }, { status: 404 })
  }

  try {
    // Ensure dev user exists in database
    await ensureDevUserExists()

    // Create a JWT token for the dev user
    const token = await encode({
      token: {
        sub: DEV_USER_ID,
        name: DEV_USER.name,
        email: DEV_USER.email,
        picture: null,
      },
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })

    // Set the session cookie
    const cookieStore = await cookies()

    // Determine the base URL from the request (handles proxies like Daytona)
    const headersList = await headers()
    const host = headersList.get("x-forwarded-host") || headersList.get("host") || "localhost:3000"
    const protocol = headersList.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https")
    const baseUrl = `${protocol}://${host}`
    const isSecure = protocol === "https"

    cookieStore.set("next-auth.session-token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })

    // Redirect to home
    return Response.redirect(new URL("/", baseUrl))
  } catch (error) {
    console.error("Dev session error:", error)
    return Response.json({ error: "Failed to create dev session" }, { status: 500 })
  }
}
