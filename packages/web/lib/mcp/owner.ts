/**
 * Owner abstraction for MCP server connections.
 *
 * Every McpServerConnection row belongs to exactly one owner — currently a
 * Chat or a ScheduledJob, modeled on the row as two nullable FKs. Code that
 * needs to read or mutate connections is parameterized by this discriminated
 * union so the chat- and job-side surfaces share one implementation.
 */
import { requireAuth, isAuthError, notFound } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"

export type McpOwner =
  | { kind: "chat"; id: string }
  | { kind: "job"; id: string }

/**
 * Where-clause fragment that selects rows belonging to the given owner.
 * Use it inline in any prisma.mcpServerConnection.find/update/delete call.
 */
export function ownerWhere(
  owner: McpOwner
): Prisma.McpServerConnectionWhereInput {
  return owner.kind === "chat"
    ? { chatId: owner.id }
    : { scheduledJobId: owner.id }
}

/**
 * Unique-where fragment for upserts keyed on (owner, qualifiedName).
 */
export function ownerUniqueWhere(
  owner: McpOwner,
  qualifiedName: string
): Prisma.McpServerConnectionWhereUniqueInput {
  return owner.kind === "chat"
    ? { chatId_qualifiedName: { chatId: owner.id, qualifiedName } }
    : {
        scheduledJobId_qualifiedName: {
          scheduledJobId: owner.id,
          qualifiedName,
        },
      }
}

/**
 * Create-data fragment for inserting a row with the right owner FK populated
 * and the other left null.
 */
export function ownerCreateData(
  owner: McpOwner
): Pick<Prisma.McpServerConnectionUncheckedCreateInput, "chatId" | "scheduledJobId"> {
  return owner.kind === "chat"
    ? { chatId: owner.id, scheduledJobId: null }
    : { chatId: null, scheduledJobId: owner.id }
}

/**
 * Verify the caller owns the underlying chat or scheduled job. Returns true
 * on success, false if the entity doesn't exist or belongs to someone else.
 */
async function requireMcpOwnerAuth(
  owner: McpOwner,
  userId: string
): Promise<boolean> {
  if (owner.kind === "chat") {
    const row = await prisma.chat.findUnique({
      where: { id: owner.id },
      select: { userId: true },
    })
    return !!row && row.userId === userId
  }
  const row = await prisma.scheduledJob.findUnique({
    where: { id: owner.id },
    select: { userId: true },
  })
  return !!row && row.userId === userId
}

export type ResolvedMcpOwner =
  | { ok: true; owner: McpOwner; userId: string }
  | { ok: false; response: Response }

/**
 * Authenticate the caller and verify they own the given chat/job. Collapses
 * the requireAuth + requireMcpOwnerAuth boilerplate shared by every
 * `/mcp-servers` route handler into a single call.
 *
 * On success returns the owner and authenticated userId; on failure returns
 * the Response (401 or 404) the handler should return verbatim.
 */
export async function resolveMcpOwner(
  owner: McpOwner
): Promise<ResolvedMcpOwner> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return { ok: false, response: auth }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    const label = owner.kind === "chat" ? "Chat" : "Scheduled job"
    return { ok: false, response: notFound(`${label} not found`) }
  }
  return { ok: true, owner, userId: auth.userId }
}
