/**
 * Owner-parameterized handlers for MCP connections: list, disconnect, attach
 * (GitHub, Gmail, vendors) and the Gmail tool policy. The per-owner Next.js
 * route files are thin wrappers that do auth, build the McpOwner, then
 * delegate here.
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { badRequest, internalError, notFound } from "@/lib/db/api-helpers"
import {
  GITHUB_MCP_QUALIFIED_NAME,
  GITHUB_MCP_URL,
  GMAIL_MCP_QUALIFIED_NAME,
  GMAIL_POLICY_PRESETS,
  gmailToolPolicySchema,
  findMcpVendor,
  vendorQualifiedName,
} from "@background-agents/mcp"
import { findMcpCredential, GITHUB_CREDENTIAL, GMAIL_CREDENTIAL } from "./credentials"
import { getGmailMcpUrl } from "./gmail"
import { isVendorConnected } from "./vendors"
import {
  type McpOwner,
  ownerCreateData,
  ownerUniqueWhere,
  ownerWhere,
} from "./owner"

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
// Disconnect
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
    await prisma.mcpServerConnection.delete({ where: { id: serverId } })
    return Response.json({ deleted: true })
  } catch (err) {
    return internalError(err)
  }
}

// =============================================================================
// Attach (GitHub, Gmail, vendors). The row only names the server; credentials
// come from the user's McpCredential at run time, so nothing secret is stored
// on it.
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
  const credential = await findMcpCredential(userId, GITHUB_CREDENTIAL)
  if (!credential?.installationId) {
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
  if (!(await findMcpCredential(userId, GMAIL_CREDENTIAL))) {
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
