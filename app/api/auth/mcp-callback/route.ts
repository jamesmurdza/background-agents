import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  decodeOAuthState,
  getOAuthEndpoints,
  exchangeCodeForTokens,
} from "@/lib/mcp-oauth"

// GET - OAuth callback from MCP server
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // Remove trailing slash to match the OAuth initiation route
  const baseUrl = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "")

  // Handle OAuth errors
  if (error) {
    console.error("[MCP OAuth] OAuth error:", error, errorDescription)
    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?error=${encodeURIComponent(errorDescription || error)}`
    )
  }

  // Validate required params
  if (!code || !state) {
    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?error=${encodeURIComponent("Missing code or state parameter")}`
    )
  }

  // Decode and validate state
  const oauthState = decodeOAuthState(state)
  if (!oauthState) {
    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?error=${encodeURIComponent("Invalid or expired state")}`
    )
  }

  const { serverId, slug, url, codeVerifier, clientId } = oauthState

  // Validate we have PKCE code verifier
  if (!codeVerifier) {
    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?error=${encodeURIComponent("Missing PKCE code verifier")}`
    )
  }

  try {
    // Verify server exists
    const server = await prisma.repoMcpServer.findUnique({
      where: { id: serverId },
      include: { repo: { select: { userId: true } } },
    })

    if (!server) {
      return NextResponse.redirect(
        `${baseUrl}/mcp-callback?error=${encodeURIComponent("Server not found")}`
      )
    }

    // Get OAuth endpoints
    const endpoints = await getOAuthEndpoints(url)
    const callbackUrl = `${baseUrl}/api/auth/mcp-callback`

    // Exchange code for tokens with PKCE
    const tokens = await exchangeCodeForTokens(
      endpoints.tokenEndpoint,
      code,
      codeVerifier,
      callbackUrl,
      clientId || "sandboxed-agents"
    )

    if (!tokens) {
      await prisma.repoMcpServer.update({
        where: { id: serverId },
        data: {
          status: "error",
          lastError: "Token exchange failed",
        },
      })

      return NextResponse.redirect(
        `${baseUrl}/mcp-callback?error=${encodeURIComponent("Failed to exchange code for tokens")}`
      )
    }

    // Calculate token expiry
    const tokenExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null

    // Update server with tokens and clientId
    await prisma.repoMcpServer.update({
      where: { id: serverId },
      data: {
        clientId: clientId || "sandboxed-agents",
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        tokenExpiry,
        status: "connected",
        lastError: null,
      },
    })

    // Redirect to success page
    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?success=true&server=${encodeURIComponent(slug)}`
    )
  } catch (err) {
    console.error("[MCP OAuth] OAuth callback error:", err)

    // Try to update server status
    try {
      await prisma.repoMcpServer.update({
        where: { id: serverId },
        data: {
          status: "error",
          lastError: err instanceof Error ? err.message : "Unknown error",
        },
      })
    } catch {
      // Ignore update error
    }

    return NextResponse.redirect(
      `${baseUrl}/mcp-callback?error=${encodeURIComponent("An unexpected error occurred")}`
    )
  }
}
