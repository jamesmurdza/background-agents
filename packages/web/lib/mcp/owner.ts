/**
 * Owner abstraction for MCP server connections.
 *
 * Every McpServerConnection row belongs to exactly one owner — currently a
 * Chat or a ScheduledJob, modeled on the row as two nullable FKs. Code that
 * needs to read or mutate connections is parameterized by this discriminated
 * union so the chat- and job-side surfaces share one implementation.
 */
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
export async function requireMcpOwnerAuth(
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
