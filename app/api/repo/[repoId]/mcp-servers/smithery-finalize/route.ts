import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError, badRequest, notFound } from "@/lib/api-helpers"
import { finalizeSmitheryConnection } from "@/lib/smithery-connect"

// POST - Finalize a Smithery Connect connection after OAuth
export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params
  const body = await req.json()
  const { serverId } = body

  if (!serverId) {
    return badRequest("Missing serverId")
  }

  // Verify repo ownership
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { userId: true },
  })

  if (!repo || repo.userId !== userId) {
    return notFound("Repository not found")
  }

  // Find the server and get the connectionId (stored in clientId field)
  const server = await prisma.repoMcpServer.findUnique({
    where: { id: serverId },
  })

  if (!server || server.repoId !== repoId) {
    return notFound("Server not found")
  }

  const connectionId = server.clientId
  if (!connectionId) {
    return badRequest("No Smithery connection ID found")
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "Smithery is not configured" },
      { status: 500 }
    )
  }

  const success = await finalizeSmitheryConnection(serverId, connectionId, apiKey)

  if (success) {
    return Response.json({ connected: true })
  }

  return Response.json(
    { error: "Connection not yet authorized. Please try again." },
    { status: 400 }
  )
}
