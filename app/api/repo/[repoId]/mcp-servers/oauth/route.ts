import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/api-helpers"
import {
  encodeOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
  getOAuthEndpoints,
  registerClient,
  type McpOAuthState,
} from "@/lib/mcp-oauth"
import {
  isSmitheryServer,
  createSmitheryConnection,
  getSmitheryConnectionId,
} from "@/lib/smithery-connect"

// GET - Start OAuth flow for MCP server
export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params
  const { searchParams } = new URL(req.url)

  const slug = searchParams.get("slug")
  const url = searchParams.get("url")
  const name = searchParams.get("name")
  const iconUrl = searchParams.get("iconUrl")

  // Validate required params
  if (!slug || !url || !name) {
    return badRequest("Missing required parameters: slug, url, name")
  }

  // Find repo and verify ownership
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { userId: true },
  })

  if (!repo) {
    return notFound("Repository not found")
  }

  if (repo.userId !== userId) {
    return notFound("Repository not found")
  }

  // Check if server already exists
  const existing = await prisma.repoMcpServer.findUnique({
    where: { repoId_slug: { repoId, slug } },
  })

  let serverId: string

  if (existing) {
    // Update existing to pending status
    await prisma.repoMcpServer.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        lastError: null,
      },
    })
    serverId = existing.id
  } else {
    // Create pending record
    const newServer = await prisma.repoMcpServer.create({
      data: {
        repoId,
        slug: slug.toLowerCase(),
        name,
        url,
        iconUrl: iconUrl || null,
        status: "pending",
      },
    })
    serverId = newServer.id
  }

  try {
    // Smithery-hosted servers use Smithery Connect instead of standard OAuth
    if (isSmitheryServer(url)) {
      const apiKey = process.env.SMITHERY_API_KEY
      if (!apiKey) {
        return Response.json(
          { error: "Smithery is not configured" },
          { status: 500 }
        )
      }

      const connectionId = getSmitheryConnectionId(repoId, slug)
      const result = await createSmitheryConnection(url, connectionId, name, apiKey)

      if (result.status === "auth_required" && result.authorizationUrl) {
        // Store connection metadata for callback
        await prisma.repoMcpServer.update({
          where: { id: serverId },
          data: { clientId: connectionId },
        })

        return Response.json({
          authUrl: result.authorizationUrl,
          serverId,
          smitheryConnect: true,
        })
      }

      if (result.status === "connected") {
        // No OAuth needed — mark as connected immediately
        await prisma.repoMcpServer.update({
          where: { id: serverId },
          data: {
            url: result.mcpEndpoint,
            accessToken: encrypt(apiKey),
            status: "connected",
            lastError: null,
          },
        })
        return Response.json({ authUrl: null, serverId, connected: true })
      }

      // Error case
      throw new Error(result.error || "Smithery connection failed")
    }

    // Non-Smithery servers: use standard MCP OAuth discovery
    // Get OAuth endpoints via discovery or defaults
    const endpoints = await getOAuthEndpoints(url)

    // Get callback URL (remove trailing slash from baseUrl if present)
    const baseUrl = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "")
    const callbackUrl = `${baseUrl}/api/auth/mcp-callback`

    console.log("[MCP OAuth] Endpoints discovered:", {
      authorizationEndpoint: endpoints.authorizationEndpoint,
      tokenEndpoint: endpoints.tokenEndpoint,
      registrationEndpoint: endpoints.registrationEndpoint,
    })

    // Check if we already have a client ID for this server (from previous registration)
    let clientId = existing?.clientId || "upstream-agents"

    // Try dynamic client registration if we don't have a client ID yet
    if (!existing?.clientId && endpoints.registrationEndpoint) {
      const registration = await registerClient(endpoints.registrationEndpoint, callbackUrl)
      if (registration) {
        clientId = registration.client_id
        // Store the client ID for future use
        await prisma.repoMcpServer.update({
          where: { id: serverId },
          data: { clientId },
        })
      }
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    // Create OAuth state
    const state: McpOAuthState = {
      repoId,
      serverId,
      slug,
      url,
      name,
      iconUrl: iconUrl || undefined,
      timestamp: Date.now(),
      codeVerifier,
      clientId,
    }

    const encodedState = encodeOAuthState(state)

    // Build the OAuth authorization URL
    const authUrl = new URL(endpoints.authorizationEndpoint)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("redirect_uri", callbackUrl)
    authUrl.searchParams.set("state", encodedState)
    authUrl.searchParams.set("code_challenge", codeChallenge)
    authUrl.searchParams.set("code_challenge_method", "S256")

    return Response.json({
      authUrl: authUrl.toString(),
      serverId,
      state: encodedState,
    })
  } catch (err) {
    console.error("[MCP OAuth] Failed to start OAuth flow:", err)

    // Update server status
    await prisma.repoMcpServer.update({
      where: { id: serverId },
      data: {
        status: "error",
        lastError: "Failed to start OAuth flow",
      },
    })

    return Response.json(
      { error: "Failed to start OAuth flow" },
      { status: 500 }
    )
  }
}
