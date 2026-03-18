import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/api-helpers"
import { encodeOAuthState, type McpOAuthState } from "@/lib/mcp-oauth"

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

  // Create OAuth state
  const state: McpOAuthState = {
    repoId,
    serverId,
    slug,
    url,
    name,
    iconUrl: iconUrl || undefined,
    timestamp: Date.now(),
  }

  const encodedState = encodeOAuthState(state)

  // Get the callback URL
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
  const callbackUrl = `${baseUrl}/api/auth/mcp-callback`

  // For MCP OAuth, we redirect to the MCP server's OAuth endpoint
  // The MCP server URL typically follows the pattern: https://mcp.service.com/mcp
  // The OAuth endpoint is typically at: https://mcp.service.com/oauth/authorize
  // However, MCP servers use dynamic discovery, so we'll use the standard MCP OAuth flow

  // Build the OAuth authorization URL
  // Most MCP servers follow OAuth 2.0 spec with authorization endpoint
  const mcpServerUrl = new URL(url)
  const oauthUrl = new URL(`${mcpServerUrl.origin}/oauth/authorize`)

  oauthUrl.searchParams.set("response_type", "code")
  oauthUrl.searchParams.set("redirect_uri", callbackUrl)
  oauthUrl.searchParams.set("state", encodedState)
  // Note: client_id is typically provided by the MCP server during registration
  // For now, we use the app name as identifier - servers may use dynamic client registration
  oauthUrl.searchParams.set("client_id", "sandboxed-agents")

  return Response.json({
    authUrl: oauthUrl.toString(),
    serverId,
    state: encodedState,
  })
}
