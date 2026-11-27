import { Prisma } from "@prisma/client"
import type { AgentSnapshot } from "@/lib/agent-session"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import type { ActiveTurn } from "@/lib/server/turn-ownership"

type SnapshotStore = {
  message: { update: (args: Prisma.MessageUpdateArgs) => Promise<unknown> }
  chat: { updateMany: (args: Prisma.ChatUpdateManyArgs) => Promise<{ count: number }> }
}

export interface SnapshotPersistClient extends SnapshotStore {
  $transaction: <T>(
    fn: (tx: SnapshotStore) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ) => Promise<T>
}

// A final write runs under the finalization claim and must land before the
// turn can be released, so it gets patient transaction budgets. Prisma's
// defaults (maxWait 2 s, timeout 5 s) aborted it mid-stall in production —
// the P2028 "Unable to start a transaction" storm and a transaction whose
// first statement stalled for 5.3 minutes. Periodic writes keep the
// defaults: they should fail fast, and the stream retries them on a doubling
// backoff (route.ts) instead of every five seconds.
const FINAL_TX_MAX_WAIT_MS = 5_000
const FINAL_TX_TIMEOUT_MS = 15_000

/** A periodic write holds the chat row lock through the message write. */
export async function persistAgentSnapshot(params: {
  prisma: SnapshotPersistClient
  turn: ActiveTurn
  snapshot: AgentSnapshot
  finalizationClaimId?: string
}): Promise<{ persisted: boolean }> {
  const { prisma, turn, snapshot, finalizationClaimId } = params
  try {
    return await prisma.$transaction(async (tx) => {
      const owned = await tx.chat.updateMany({
        where: {
          id: turn.chatId,
          status: "running",
          backgroundSessionId: turn.backgroundSessionId,
          activeAssistantMessageId: turn.assistantMessageId,
          finalizationClaimId: finalizationClaimId ?? null,
        },
        // A no-op update acquires the row lock so a finalizer cannot release
        // the chat and start the next turn before this write commits.
        data: { queueSequence: { increment: 0 } },
      })
      if (owned.count !== 1) return { persisted: false }

      await tx.message.update({
        where: { id: turn.assistantMessageId },
        data: {
          content: stripNullBytes(snapshot.content),
          toolCalls: snapshot.toolCalls.length > 0
            ? (stripNullBytesDeep(snapshot.toolCalls) as unknown as Prisma.InputJsonValue)
            : undefined,
          contentBlocks: snapshot.contentBlocks.length > 0
            ? (stripNullBytesDeep(snapshot.contentBlocks) as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      })
      return { persisted: true }
    }, finalizationClaimId
      ? { maxWait: FINAL_TX_MAX_WAIT_MS, timeout: FINAL_TX_TIMEOUT_MS }
      : undefined)
  } catch (error) {
    // Finalizers must keep the turn recoverable when this fails. Periodic
    // writers can retry; a failed final write must never release the chat.
    console.error("[agent/stream] message persist error:", error)
    return { persisted: false }
  }
}
