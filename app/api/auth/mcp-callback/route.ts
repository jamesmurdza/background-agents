import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import { decodeOAuthState, type McpOAuthState } from "@/lib/mcp-oauth"

// GET - OAuth callback from MCP server
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

  // Handle OAuth errors
  if (error) {
    console.error("MCP OAuth error:", error, errorDescription)
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

  const { serverId, slug, url } = oauthState

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

    // Exchange code for tokens
    const mcpServerUrl = new URL(url)
    const tokenUrl = `${mcpServerUrl.origin}/oauth/token`
    const callbackUrl = `${baseUrl}/api/auth/mcp-callback`

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: "sandboxed-agents",
        // Note: client_secret would be needed for confidential clients
        // For public clients or dynamic registration, this may not be needed
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error("Token exchange failed:", errorText)

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

    const tokens = await tokenResponse.json()

    // Calculate token expiry
    const tokenExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null

    // Update server with tokens
    await prisma.repoMcpServer.update({
      where: { id: serverId },
      data: {
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
    console.error("MCP OAuth callback error:", err)

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
