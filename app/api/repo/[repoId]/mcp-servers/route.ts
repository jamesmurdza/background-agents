import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/api-helpers"

// GET - List MCP servers for a repo
export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params

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

  // Get MCP servers for this repo
  const mcpServers = await prisma.repoMcpServer.findMany({
    where: { repoId },
    select: {
      id: true,
      slug: true,
      name: true,
      url: true,
      iconUrl: true,
      status: true,
      lastError: true,
      tokenExpiry: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })

  // Transform to hide sensitive data, add hasToken flag
  const servers = mcpServers.map((server) => ({
    id: server.id,
    slug: server.slug,
    name: server.name,
    url: server.url,
    iconUrl: server.iconUrl,
    status: server.status,
    lastError: server.lastError,
    tokenExpiry: server.tokenExpiry?.toISOString() || null,
    createdAt: server.createdAt.toISOString(),
  }))

  return Response.json({ servers })
}

// POST - Add MCP server to repo (creates pending record for OAuth)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params

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

  const body = await req.json()
  const { slug, name, url, iconUrl, accessToken, refreshToken, tokenExpiry } = body as {
    slug: string
    name: string
    url: string
    iconUrl?: string
    accessToken?: string
    refreshToken?: string
    tokenExpiry?: string
  }

  // Validate required fields
  if (!slug || typeof slug !== "string") {
    return badRequest("Missing or invalid slug")
  }
  if (!name || typeof name !== "string") {
    return badRequest("Missing or invalid name")
  }
  if (!url || typeof url !== "string") {
    return badRequest("Missing or invalid url")
  }

  // Validate URL is HTTPS
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== "https:") {
      return badRequest("URL must use HTTPS")
    }
  } catch {
    return badRequest("Invalid URL format")
  }

  // Check if server already exists for this repo
  const existing = await prisma.repoMcpServer.findUnique({
    where: { repoId_slug: { repoId, slug } },
  })

  if (existing) {
    return badRequest(`MCP server '${slug}' already configured for this repository`)
  }

  // Determine initial status
  const hasTokens = accessToken && accessToken.trim().length > 0
  const status = hasTokens ? "connected" : "pending"

  // Create the MCP server record
  const mcpServer = await prisma.repoMcpServer.create({
    data: {
      repoId,
      slug: slug.toLowerCase(),
      name,
      url,
      iconUrl: iconUrl || null,
      accessToken: accessToken ? encrypt(accessToken) : null,
      refreshToken: refreshToken ? encrypt(refreshToken) : null,
      tokenExpiry: tokenExpiry ? new Date(tokenExpiry) : null,
      status,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      url: true,
      iconUrl: true,
      status: true,
      createdAt: true,
    },
  })

  return Response.json({
    server: {
      id: mcpServer.id,
      slug: mcpServer.slug,
      name: mcpServer.name,
      url: mcpServer.url,
      iconUrl: mcpServer.iconUrl,
      status: mcpServer.status,
      createdAt: mcpServer.createdAt.toISOString(),
    },
  })
}
