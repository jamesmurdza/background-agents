import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Allowed origins for Electron app and development
const ALLOWED_ORIGINS = [
  "app://.",                          // Electron custom protocol
  "file://",                          // Electron file protocol
  "http://localhost:4000",            // Local development
  "http://localhost:3000",            // Alternative local
  "https://agents.new",               // Production
]

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin")
  const response = NextResponse.next()

  // Handle CORS for Electron and development
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some(
      (allowed) => origin === allowed || origin.startsWith(allowed)
    )

    if (isAllowed) {
      response.headers.set("Access-Control-Allow-Origin", origin)
      response.headers.set("Access-Control-Allow-Credentials", "true")
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      )
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      )
    }
  }

  // Handle preflight requests
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    })
  }

  return response
}

// Apply middleware to API routes
export const config = {
  matcher: "/api/:path*",
}
