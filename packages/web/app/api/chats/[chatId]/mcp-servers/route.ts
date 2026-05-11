/**
 * GET  /api/chats/<chatId>/mcp-servers     list connections on this chat
 * POST /api/chats/<chatId>/mcp-servers     start a new connection via Smithery
 *
 * POST body: { slug, url?, name, iconUrl? }
 *   - slug          qualifiedName from the registry (e.g. "exa/exa-search")
 *   - url           remote MCP URL. If absent (non-deployed server), the client
 *                   should have fetched it from /api/mcp-registry/<slug> first.
 *   - name          display name
 *   - iconUrl       optional
 *
 * POST returns one of:
 *   { connected: true,  serverId }                    instant-connect succeeded
 *   { connected: false, serverId, authUrl }           open authUrl in a popup,
 *                                                     then POST /smithery-finalize
 */
import { prisma } from "@/lib/db/prisma"
import { encrypt } from "@/lib/db/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  serverConfigError,
  internalError,
  getChatWithAuth,
} from "@/lib/db/api-helpers"
import {
  createSmitheryConnection,
  getSmitheryConnectionId,
  isSmitheryServer,
} from "@/lib/mcp/smithery-connect"

interface ConnectBody {
  slug?: string
  url?: string
  name?: string
  iconUrl?: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  const servers = await prisma.chatMcpServer.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      qualifiedName: true,
      displayName: true,
      iconUrl: true,
      status: true,
      lastError: true,
      createdAt: true,
    },
  })

  return Response.json({ servers })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  let body: ConnectBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }

  const { slug, url, name, iconUrl } = body
  if (!slug || !url || !name) {
    return badRequest("Missing required fields: slug, url, name")
  }

  // We only support Smithery-hosted servers in this PR. Standard MCP OAuth
  // discovery is intentionally out of scope here.
  if (!isSmitheryServer(url)) {
    return badRequest(
      "Only Smithery-hosted servers (server.smithery.ai) are supported"
    )
  }

  try {
    // Smithery's PUT is idempotent; safe to call before we touch our DB.
    const connectionId = getSmitheryConnectionId(chatId, slug)
    const result = await createSmitheryConnection(url, connectionId, name, apiKey)

    if (result.status === "error") {
      return Response.json(
        { error: result.error ?? "Smithery connection failed" },
        { status: 502 }
      )
    }

    const isConnected = result.status === "connected"
    const row = {
      smitheryConnectionId: connectionId,
      smitheryNamespace: result.namespace,
      mcpUrl: result.mcpEndpoint,
      status: isConnected ? "connected" : "pending",
      encryptedApiKey: isConnected ? encrypt(apiKey) : null,
      lastError: null,
    }
    const { id: serverId } = await prisma.chatMcpServer.upsert({
      where: { chatId_qualifiedName: { chatId, qualifiedName: slug } },
      create: {
        chatId,
        qualifiedName: slug,
        displayName: name,
        iconUrl: iconUrl ?? null,
        ...row,
      },
      update: {
        displayName: name,
        iconUrl: iconUrl ?? null,
        ...row,
      },
      select: { id: true },
    })

    if (isConnected) {
      return Response.json({ connected: true, serverId })
    }
    return Response.json({
      connected: false,
      serverId,
      authUrl: result.authorizationUrl,
    })
  } catch (err) {
    return internalError(err)
  }
}
