/**
 * Owner-parameterized handlers for MCP connection CRUD + GitHub sentinel +
 * Smithery finalize. The per-owner Next.js route files are thin wrappers that
 * do auth, build the McpOwner, then delegate here.
 */
import { prisma } from "@/lib/db/prisma"
import { encrypt } from "@/lib/db/encryption"
import {
  badRequest,
  internalError,
  notFound,
  serverConfigError,
} from "@/lib/db/api-helpers"
import {
  createSmitheryProvider,
  getSmitheryConnectionId,
  isSmitheryServer,
  GITHUB_MCP_QUALIFIED_NAME,
  GITHUB_MCP_URL,
} from "@upstream/mcp-providers"
import {
  type McpOwner,
  ownerCreateData,
  ownerUniqueWhere,
  ownerWhere,
} from "./owner"

// =============================================================================
// Smithery connection-id prefix per owner kind. Keeps chat-scoped and
// job-scoped Smithery connections in separate namespaces on Smithery's side.
// =============================================================================

function smitheryPrefix(owner: McpOwner): "chat" | "job" {
  return owner.kind === "chat" ? "chat" : "job"
}

// =============================================================================
// List
// =============================================================================

export async function listConnectionsResponse(owner: McpOwner): Promise<Response> {
  const servers = await prisma.mcpServerConnection.findMany({
    where: ownerWhere(owner),
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

// =============================================================================
// Connect (Smithery)
// =============================================================================

export interface ConnectSmitheryBody {
  slug?: string
  url?: string
  name?: string
  iconUrl?: string | null
}

export async function connectSmitheryResponse(
  owner: McpOwner,
  body: ConnectSmitheryBody
): Promise<Response> {
  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  const { slug, url, name, iconUrl } = body
  if (!slug || !url || !name) {
    return badRequest("Missing required fields: slug, url, name")
  }

  if (!isSmitheryServer(url)) {
    return badRequest(
      "Only Smithery-hosted servers (server.smithery.ai) are supported"
    )
  }

  try {
    const smithery = createSmitheryProvider({
      apiKey,
      namespace: process.env.SMITHERY_NAMESPACE,
    })
    const connectionId = getSmitheryConnectionId(
      owner.id,
      slug,
      smitheryPrefix(owner)
    )
    const result = await smithery.createConnection(url, connectionId, name)

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
    const { id: serverId } = await prisma.mcpServerConnection.upsert({
      where: ownerUniqueWhere(owner, slug),
      create: {
        ...ownerCreateData(owner),
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

// =============================================================================
// Disconnect (any kind — Smithery or GitHub sentinel)
// =============================================================================

export async function disconnectResponse(
  owner: McpOwner,
  serverId: string
): Promise<Response> {
  const server = await prisma.mcpServerConnection.findUnique({
    where: { id: serverId },
  })
  if (!server || !rowMatchesOwner(server, owner)) {
    return notFound("Server not found")
  }

  try {
    const apiKey = process.env.SMITHERY_API_KEY
    if (apiKey && server.smitheryConnectionId) {
      const smithery = createSmitheryProvider({
        apiKey,
        namespace: process.env.SMITHERY_NAMESPACE,
      })
      await smithery.deleteConnection(server.smitheryConnectionId)
    }

    await prisma.mcpServerConnection.delete({ where: { id: serverId } })
    return Response.json({ deleted: true })
  } catch (err) {
    return internalError(err)
  }
}

// =============================================================================
// GitHub sentinel attach
// =============================================================================

export async function attachGithubResponse(
  owner: McpOwner,
  userId: string
): Promise<Response> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAppInstallationId: true },
  })
  if (!user?.githubAppInstallationId) {
    return Response.json(
      { error: "GitHub App not installed for this user" },
      { status: 409 }
    )
  }

  try {
    const { id: serverId } = await prisma.mcpServerConnection.upsert({
      where: ownerUniqueWhere(owner, GITHUB_MCP_QUALIFIED_NAME),
      create: {
        ...ownerCreateData(owner),
        qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
        displayName: "GitHub",
        iconUrl: null,
        mcpUrl: GITHUB_MCP_URL,
        status: "connected",
      },
      update: {
        status: "connected",
        lastError: null,
      },
      select: { id: true },
    })
    return Response.json({ connected: true, serverId })
  } catch (err) {
    return internalError(err)
  }
}

// =============================================================================
// Smithery finalize (poll after OAuth popup closes)
// =============================================================================

export async function finalizeSmitheryResponse(
  owner: McpOwner,
  serverId: string
): Promise<Response> {
  const server = await prisma.mcpServerConnection.findUnique({
    where: { id: serverId },
  })
  if (!server || !rowMatchesOwner(server, owner)) {
    return notFound("Server not found")
  }
  if (!server.smitheryConnectionId) {
    return badRequest("Server has no Smithery connection id")
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  try {
    const smithery = createSmitheryProvider({
      apiKey,
      namespace: process.env.SMITHERY_NAMESPACE,
    })

    const status = await smithery.getConnectionStatus(
      server.smitheryConnectionId
    )

    if (status.state === "connected") {
      const namespace = await smithery.getNamespace()
      if (!namespace) {
        return Response.json(
          { error: "Failed to resolve Smithery namespace" },
          { status: 500 }
        )
      }

      const mcpEndpoint = smithery.getMcpEndpointWithNamespace(
        namespace,
        server.smitheryConnectionId
      )

      await prisma.mcpServerConnection.update({
        where: { id: serverId },
        data: {
          mcpUrl: mcpEndpoint,
          smitheryNamespace: namespace,
          encryptedApiKey: encrypt(apiKey),
          status: "connected",
          lastError: null,
        },
      })

      return Response.json({ connected: true })
    }

    return Response.json(
      { error: "Connection not yet authorized. Please try again." },
      { status: 400 }
    )
  } catch (err) {
    return internalError(err)
  }
}

// =============================================================================
// Smithery cleanup on owner delete. Cascade handles our DB rows; Smithery has
// to be told explicitly or its connection lingers and counts against quota.
// =============================================================================

export async function cleanupSmitheryConnections(owner: McpOwner): Promise<void> {
  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return

  const rows = await prisma.mcpServerConnection.findMany({
    where: { ...ownerWhere(owner), smitheryConnectionId: { not: null } },
    select: { smitheryConnectionId: true },
  })
  if (rows.length === 0) return

  const smithery = createSmitheryProvider({
    apiKey,
    namespace: process.env.SMITHERY_NAMESPACE,
  })
  for (const row of rows) {
    if (!row.smitheryConnectionId) continue
    try {
      await smithery.deleteConnection(row.smitheryConnectionId)
    } catch (err) {
      console.error("[mcp] Smithery cleanup failed (non-fatal):", err)
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function rowMatchesOwner(
  row: { chatId: string | null; scheduledJobId: string | null },
  owner: McpOwner
): boolean {
  return owner.kind === "chat"
    ? row.chatId === owner.id
    : row.scheduledJobId === owner.id
}
