import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { ActiveTurn } from "./turn-ownership"
import { stripNullBytes } from "@/lib/db/pg-sanitize"

export type TurnFailure = {
  state: "error"
  executionStopped: boolean
  backgroundSessionId: string
  assistantMessageId: string
  reason: string
}

export async function readTurnFailure(turn: ActiveTurn): Promise<TurnFailure | null> {
  const message = await prisma.message.findUnique({ where: { id: turn.assistantMessageId }, select: { metadata: true } })
  const metadata = message?.metadata as Record<string, unknown> | null
  const value = metadata?.turnFinalization as TurnFailure | undefined
  return value?.state === "error" && value.backgroundSessionId === turn.backgroundSessionId &&
    value.assistantMessageId === turn.assistantMessageId && typeof value.reason === "string"
    ? value : null
}

/** Save the decision before cancellation, then confirm it only after the final
 * output is durable. A later observer must not turn a cancelled timeout into a
 * successful completion just because the process is no longer running. */
export async function recordTurnFailure(
  turn: ActiveTurn,
  claimId: string,
  reason: string,
  executionStopped: boolean,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.chat.updateMany({
      where: { id: turn.chatId, status: "running", backgroundSessionId: turn.backgroundSessionId, activeAssistantMessageId: turn.assistantMessageId, finalizationClaimId: claimId },
      data: { queueSequence: { increment: 0 } },
    })
    if (owned.count !== 1) return false
    const message = await tx.message.findUniqueOrThrow({ where: { id: turn.assistantMessageId }, select: { metadata: true } })
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {}
    const outcome: TurnFailure = { state: "error", executionStopped, backgroundSessionId: turn.backgroundSessionId, assistantMessageId: turn.assistantMessageId, reason: stripNullBytes(reason) }
    await tx.message.update({ where: { id: turn.assistantMessageId }, data: { metadata: { ...metadata, turnFinalization: outcome } as Prisma.InputJsonValue } })
    return true
  })
}
