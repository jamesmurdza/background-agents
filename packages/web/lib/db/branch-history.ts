import { prisma } from "@/lib/db/prisma"

// =============================================================================
// Inherited (branch-point) history
// =============================================================================
//
// A branched chat doesn't copy its parent's messages — it points at the parent
// (`parentChatId`) and the parent's conversation is read back on demand: shown
// above the branch's own messages (flagged `inherited`) and replayed to the
// agent on the branch's first turn.
//
// That read MUST be frozen at the moment the branch was taken. The branch row
// is created right when the user branches, so the branch's own `createdAt` is
// the branch point: anything the parent said after it belongs to the parent
// alone. Without the cutoff the inherited block is a *live view* of the parent —
// keep talking in the parent and its later turns silently appear in the child's
// history on the next full fetch (and get replayed to the child's agent).

/** A message row as returned by Prisma, narrowed to non-null. */
type MessageRow = NonNullable<Awaited<ReturnType<typeof prisma.message.findFirst>>>

/** Identifies the branch point: the parent to read, cut off at the branch's creation. */
export interface BranchPoint {
  parentChatId: string
  /** The branched chat's own `createdAt` — see the module comment. */
  createdAt: Date
}

function branchPointWhere({ parentChatId, createdAt }: BranchPoint) {
  return {
    chatId: parentChatId,
    role: { in: ["user", "assistant"] },
    createdAt: { lte: createdAt },
  }
}

/** Non-empty user/assistant rows are the only ones worth inheriting. */
function hasContent(m: { content: string }): boolean {
  return m.content.trim().length > 0
}

/**
 * Full parent message rows as they stood at the branch point, oldest first.
 * For rendering the inherited block (private chat view and public share view).
 */
export async function getInheritedMessages(point: BranchPoint): Promise<MessageRow[]> {
  const messages = await prisma.message.findMany({
    where: branchPointWhere(point),
    orderBy: { timestamp: "asc" },
  })
  return messages.filter(hasContent)
}

/**
 * The same conversation reduced to what an agent CLI needs for context replay.
 * Returns undefined when there's nothing to replay.
 */
export async function getInheritedHistory(
  point: BranchPoint
): Promise<{ role: "user" | "assistant"; content: string }[] | undefined> {
  const messages = await prisma.message.findMany({
    where: branchPointWhere(point),
    orderBy: { timestamp: "asc" },
    select: { role: true, content: true },
  })
  const history = messages
    .filter(hasContent)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  return history.length > 0 ? history : undefined
}
