import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { ActiveTurn } from "./turn-ownership"
import { stripNullBytes } from "@/lib/db/pg-sanitize"
import { mergeFailureMarkers, readFailureMarker, type TurnFailureMarker } from "@/lib/turn-failure-marker"

export type TurnFailure = TurnFailureMarker

// Same rationale as persist-snapshot: the production pool holds one
// connection per instance (lib/db/prisma), and Prisma's default maxWait of
// 2 s killed this fence with P2028 whenever the pool was busy. This write
// must land while the finalization claim is held, so it gets patient budgets.
const FAILURE_TX_MAX_WAIT_MS = 5_000
const FAILURE_TX_TIMEOUT_MS = 15_000

export async function readTurnFailure(turn: ActiveTurn): Promise<TurnFailure | null> {
  const message = await prisma.message.findUnique({ where: { id: turn.assistantMessageId }, select: { metadata: true } })
  const metadata = message?.metadata as Record<string, unknown> | null
  return readFailureMarker(metadata?.turnFinalization, turn.assistantMessageId, turn.backgroundSessionId) ?? null
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
    const previous = readFailureMarker(metadata.turnFinalization, turn.assistantMessageId, turn.backgroundSessionId)
    await tx.message.update({ where: { id: turn.assistantMessageId }, data: { metadata: {
      ...metadata, turnFinalization: mergeFailureMarkers(previous, outcome),
    } as Prisma.InputJsonValue } })
    return true
  }, { maxWait: FAILURE_TX_MAX_WAIT_MS, timeout: FAILURE_TX_TIMEOUT_MS })
}
