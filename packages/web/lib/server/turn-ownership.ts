import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/db/prisma"

export interface ActiveTurn {
  chatId: string
  backgroundSessionId: string
  assistantMessageId: string
}

// Both stream and cron functions are capped at five minutes. A dead owner can
// be recovered by cron after seven minutes, without stealing a live worker.
const FINALIZATION_STALE_AFTER_MS = 7 * 60 * 1000

export async function claimTurnFinalization(turn: ActiveTurn): Promise<string | null> {
  const claimId = randomUUID()
  const claimed = await prisma.chat.updateMany({
    where: {
      id: turn.chatId,
      status: "running",
      backgroundSessionId: turn.backgroundSessionId,
      activeAssistantMessageId: turn.assistantMessageId,
      OR: [
        { finalizationClaimId: null },
        { finalizationClaimedAt: { lt: new Date(Date.now() - FINALIZATION_STALE_AFTER_MS) } },
      ],
    },
    data: { finalizationClaimId: claimId, finalizationClaimedAt: new Date() },
  })
  return claimed.count === 1 ? claimId : null
}

export async function releaseTurn(
  turn: ActiveTurn,
  claimId: string,
  status: "ready" | "error",
  sessionId?: string | null,
): Promise<boolean> {
  const released = await prisma.chat.updateMany({
    where: {
      id: turn.chatId,
      status: "running",
      backgroundSessionId: turn.backgroundSessionId,
      activeAssistantMessageId: turn.assistantMessageId,
      finalizationClaimId: claimId,
    },
    data: {
      status,
      backgroundSessionId: null,
      activeAssistantMessageId: null,
      finalizationClaimId: null,
      finalizationClaimedAt: null,
      sessionId: sessionId || undefined,
      lastActiveAt: new Date(),
    },
  })
  return released.count === 1
}

export async function abandonFinalization(turn: ActiveTurn, claimId: string): Promise<void> {
  await prisma.chat.updateMany({
    where: {
      id: turn.chatId,
      backgroundSessionId: turn.backgroundSessionId,
      activeAssistantMessageId: turn.assistantMessageId,
      finalizationClaimId: claimId,
    },
    data: { finalizationClaimId: null, finalizationClaimedAt: null },
  })
}
