/**
 * Owner-parameterized handlers for MCP connection CRUD + GitHub/Gmail
 * sentinels + Gmail tool policy + Smithery finalize. The per-owner Next.js route files are thin wrappers that
 * do auth, build the McpOwner, then delegate here.
 */
import type { Prisma } from "@prisma/client"
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
  GMAIL_MCP_QUALIFIED_NAME,
  GMAIL_POLICY_PRESETS,
  gmailToolPolicySchema,
  PADDLE_MCP_QUALIFIED_NAME,
  PADDLE_MCP_URL,
  findMcpVendor,
  vendorQualifiedName,
} from "@background-agents/mcp"
import { getGmailMcpUrl } from "./gmail"
import { isVendorConnected } from "./vendors"
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
      toolPolicy: true,
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
// Sentinel attach (GitHub, Gmail). These rows point at a first-party server;
// the runtime loader mints credentials per turn, so nothing secret is stored.
// =============================================================================

async function attachSentinelResponse(
  owner: McpOwner,
  create: Pick<
    Prisma.McpServerConnectionUncheckedCreateInput,
    "qualifiedName" | "displayName" | "mcpUrl" | "toolPolicy"
  >
): Promise<Response> {
  try {
    const { id: serverId } = await prisma.mcpServerConnection.upsert({
      where: ownerUniqueWhere(owner, create.qualifiedName),
      create: {
        ...ownerCreateData(owner),
        ...create,
        iconUrl: null,
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
  return attachSentinelResponse(owner, {
    qualifiedName: GITHUB_MCP_QUALIFIED_NAME,
    displayName: "GitHub",
    mcpUrl: GITHUB_MCP_URL,
  })
}

export async function attachGmailResponse(
  owner: McpOwner,
  userId: string
): Promise<Response> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshTokenEncrypted: true },
  })
  if (!user?.googleRefreshTokenEncrypted) {
    return Response.json(
      { error: "Google account not connected for this user" },
      { status: 409 }
    )
  }
  return attachSentinelResponse(owner, {
    qualifiedName: GMAIL_MCP_QUALIFIED_NAME,
    displayName: "Gmail",
    mcpUrl: getGmailMcpUrl(),
    // Chats start at read + draft (a person sends); scheduled jobs run
    // unattended, so they start read-only.
    toolPolicy:
      owner.kind === "chat"
        ? GMAIL_POLICY_PRESETS.readDraft
        : GMAIL_POLICY_PRESETS.readOnly,
  })
}

export async function attachPaddleResponse(
  owner: McpOwner,
  userId: string
): Promise<Response> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { paddleRefreshTokenEncrypted: true },
  })
  if (!user?.paddleRefreshTokenEncrypted) {
    return Response.json(
      { error: "Paddle account not connected for this user" },
      { status: 409 }
    )
  }
  return attachSentinelResponse(owner, {
    qualifiedName: PADDLE_MCP_QUALIFIED_NAME,
    displayName: "Paddle",
    mcpUrl: PADDLE_MCP_URL,
  })
}

/** Attach a vendor-hosted MCP server (see MCP_VENDORS) the user has linked. */
export async function attachVendorResponse(
  owner: McpOwner,
  userId: string,
  slug: string
): Promise<Response> {
  const vendor = findMcpVendor(slug)
  if (!vendor) return notFound("Unknown MCP vendor")
  if (!(await isVendorConnected(userId, vendor))) {
    return Response.json(
      { error: `${vendor.name} account not connected for this user` },
      { status: 409 }
    )
  }
  return attachSentinelResponse(owner, {
    qualifiedName: vendorQualifiedName(vendor),
    displayName: vendor.name,
    mcpUrl: vendor.mcpUrl,
  })
}

// =============================================================================
// Gmail tool policy update
// =============================================================================

export async function updateToolPolicyResponse(
  owner: McpOwner,
  serverId: string,
  body: unknown
): Promise<Response> {
  const parsed = gmailToolPolicySchema.safeParse(
    (body as { toolPolicy?: unknown } | null)?.toolPolicy
  )
  if (!parsed.success) {
    return badRequest(`Invalid toolPolicy: ${parsed.error.message}`)
  }

  const server = await prisma.mcpServerConnection.findUnique({
    where: { id: serverId },
    select: { chatId: true, scheduledJobId: true, qualifiedName: true },
  })
  if (!server || !rowMatchesOwner(server, owner)) {
    return notFound("Server not found")
  }
  if (server.qualifiedName !== GMAIL_MCP_QUALIFIED_NAME) {
    return badRequest("Only Gmail connections have a tool policy")
  }

  try {
    await prisma.mcpServerConnection.update({
      where: { id: serverId },
      data: { toolPolicy: parsed.data },
    })
    return Response.json({ toolPolicy: parsed.data })
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
