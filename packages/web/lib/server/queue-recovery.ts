import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

type RecoveryStore = Pick<Prisma.TransactionClient, "chat">
export interface TerminalQueueRecoveryIntent {
  updatedAt: number
  assistantMessageId: string
}

/** Only a saved, confirmed terminal execution can be deliberately skipped. */
export async function readTerminalQueueRecovery(chatId: string, store: RecoveryStore = prisma): Promise<TerminalQueueRecoveryIntent | null> {
  const chat = await store.chat.findUnique({ where: { id: chatId }, select: {
    status: true, updatedAt: true, backgroundSessionId: true, activeAssistantMessageId: true,
    queueDispatchId: true, finalizationClaimId: true,
    scheduledJobRun: { select: { id: true } },
    queuedPrompts: { where: { status: "dispatching" }, take: 1, select: { id: true } },
    messages: {
      where: { role: "assistant", NOT: { id: { endsWith: ":error" } } },
      orderBy: { timestamp: "desc" }, take: 1, select: { id: true, metadata: true },
    },
  } })
  if (!chat || chat.status !== "error" || chat.backgroundSessionId || chat.activeAssistantMessageId ||
      chat.queueDispatchId || chat.finalizationClaimId || chat.scheduledJobRun || chat.queuedPrompts.length) return null
  const assistant = chat.messages[0]
  if (!assistant) return null
  const metadata = assistant.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const marker = metadata.turnFinalization
  if (!marker || typeof marker !== "object" || Array.isArray(marker) ||
      marker.state !== "error" || marker.executionStopped !== true ||
      marker.assistantMessageId !== assistant.id || typeof marker.backgroundSessionId !== "string" || !marker.backgroundSessionId) return null
  return { updatedAt: chat.updatedAt.getTime(), assistantMessageId: assistant.id }
}

/** User intent only: preserve FIFO and never create/resend the failed prompt. */
export async function recoverTerminalQueue(chatId: string, intent: TerminalQueueRecoveryIntent): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Same chat-row lock as enqueue/claim. Preserve the timestamp for this
    // no-op lock so a rejected recovery does not invalidate another observer.
    const locked = await tx.chat.updateMany({
      where: { id: chatId, status: "error", updatedAt: new Date(intent.updatedAt),
        backgroundSessionId: null, activeAssistantMessageId: null, queueDispatchId: null, finalizationClaimId: null },
      data: { queueSequence: { increment: 0 }, updatedAt: new Date(intent.updatedAt) },
    })
    if (locked.count !== 1) return false
    const confirmed = await readTerminalQueueRecovery(chatId, tx)
    if (!confirmed || confirmed.assistantMessageId !== intent.assistantMessageId) return false
    await tx.chat.update({ where: { id: chatId }, data: { status: "ready", queuePaused: false } })
    return true
  })
}
