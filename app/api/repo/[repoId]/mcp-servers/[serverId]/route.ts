import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
} from "@/lib/api-helpers"

// GET - Get single MCP server details
export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string; serverId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId, serverId } = await params

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

  // Get the MCP server
  const mcpServer = await prisma.repoMcpServer.findFirst({
    where: { id: serverId, repoId },
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
  })

  if (!mcpServer) {
    return notFound("MCP server not found")
  }

  return Response.json({
    server: {
      id: mcpServer.id,
      slug: mcpServer.slug,
      name: mcpServer.name,
      url: mcpServer.url,
      iconUrl: mcpServer.iconUrl,
      status: mcpServer.status,
      lastError: mcpServer.lastError,
      tokenExpiry: mcpServer.tokenExpiry?.toISOString() || null,
      createdAt: mcpServer.createdAt.toISOString(),
    },
  })
}

// DELETE - Remove MCP server from repo
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ repoId: string; serverId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId, serverId } = await params

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

  // Check if server exists
  const mcpServer = await prisma.repoMcpServer.findFirst({
    where: { id: serverId, repoId },
  })

  if (!mcpServer) {
    return notFound("MCP server not found")
  }

  // Delete the MCP server
  await prisma.repoMcpServer.delete({
    where: { id: serverId },
  })

  return Response.json({ success: true })
}
