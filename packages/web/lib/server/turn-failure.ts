import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { ActiveTurn } from "./turn-ownership"
import { stripNullBytes } from "@/lib/db/pg-sanitize"
import { mergeFailureMarkers, readFailureMarker, type TurnFailureMarker } from "@/lib/turn-failure-marker"

export type TurnFailure = TurnFailureMarker

export async function readTurnFailure(turn: ActiveTurn): Promise<TurnFailure | null> {
  const message = await prisma.message.findUnique({ where: { id: turn.assistantMessageId }, select: { metadata: true } })
  const metadata = message?.metadata as Record<string, unknown> | null
  return readFailureMarker(metadata?.turnFinalization, turn.assistantMessageId, turn.backgroundSessionId) ?? null
}

/** Keep a failed launch response with its turn. The process may still have
 * started, so this is informational until the startup timeout fences it. */
export function recordTurnLaunchError(turn: ActiveTurn, reason: string): Promise<boolean> {
  return updateOwnedTurnMetadata(turn, null, (metadata) => ({ ...metadata, launchError: stripNullBytes(reason) }))
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
  return updateOwnedTurnMetadata(turn, claimId, (metadata) => {
    const outcome: TurnFailure = { state: "error", executionStopped, backgroundSessionId: turn.backgroundSessionId, assistantMessageId: turn.assistantMessageId, reason: stripNullBytes(reason) }
    const previous = readFailureMarker(metadata.turnFinalization, turn.assistantMessageId, turn.backgroundSessionId)
    return { ...metadata, turnFinalization: mergeFailureMarkers(previous, outcome) }
  })
}

function updateOwnedTurnMetadata(
  turn: ActiveTurn,
  claimId: string | null,
  update: (metadata: Prisma.JsonObject) => Prisma.InputJsonObject,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.chat.updateMany({
      where: { id: turn.chatId, status: "running", backgroundSessionId: turn.backgroundSessionId, activeAssistantMessageId: turn.assistantMessageId, finalizationClaimId: claimId },
      data: { queueSequence: { increment: 0 } },
    })
    if (owned.count !== 1) return false
    const message = await tx.message.findUniqueOrThrow({ where: { id: turn.assistantMessageId }, select: { metadata: true } })
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata : {}
    await tx.message.update({ where: { id: turn.assistantMessageId }, data: { metadata: update(metadata) } })
    return true
  })
}
