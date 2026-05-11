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
    // Upsert by (chatId, qualifiedName). Re-clicking Connect on an existing
    // row is fine — Smithery's PUT is idempotent.
    const existing = await prisma.chatMcpServer.findUnique({
      where: { chatId_qualifiedName: { chatId, qualifiedName: slug } },
    })

    const connectionId = getSmitheryConnectionId(chatId, slug)

    let serverId: string
    if (existing) {
      serverId = existing.id
      await prisma.chatMcpServer.update({
        where: { id: existing.id },
        data: {
          displayName: name,
          iconUrl: iconUrl ?? null,
          status: "pending",
          lastError: null,
        },
      })
    } else {
      const created = await prisma.chatMcpServer.create({
        data: {
          chatId,
          qualifiedName: slug,
          displayName: name,
          iconUrl: iconUrl ?? null,
          smitheryConnectionId: connectionId,
          smitheryNamespace: "", // populated by createSmitheryConnection
          mcpUrl: url, // placeholder; replaced with Smithery endpoint on success
          status: "pending",
        },
      })
      serverId = created.id
    }

    const result = await createSmitheryConnection(url, connectionId, name, apiKey)

    if (result.status === "auth_required" && result.authorizationUrl) {
      // Persist namespace + endpoint URL now so the finalize call has them.
      await prisma.chatMcpServer.update({
        where: { id: serverId },
        data: {
          smitheryNamespace: result.namespace,
          mcpUrl: result.mcpEndpoint,
        },
      })
      return Response.json({
        connected: false,
        serverId,
        authUrl: result.authorizationUrl,
      })
    }

    if (result.status === "connected") {
      await prisma.chatMcpServer.update({
        where: { id: serverId },
        data: {
          smitheryNamespace: result.namespace,
          mcpUrl: result.mcpEndpoint,
          encryptedApiKey: encrypt(apiKey),
          status: "connected",
          lastError: null,
        },
      })
      return Response.json({ connected: true, serverId })
    }

    await prisma.chatMcpServer.update({
      where: { id: serverId },
      data: {
        status: "error",
        lastError: result.error ?? "Smithery connection failed",
      },
    })
    return Response.json(
      { error: result.error ?? "Smithery connection failed" },
      { status: 502 }
    )
  } catch (err) {
    return internalError(err)
  }
}
