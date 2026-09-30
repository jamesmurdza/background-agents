import { randomUUID } from "node:crypto"
import type { QueuedPrompt } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { QueuedMessage } from "@/lib/types"

export type QueueItem = Pick<QueuedPrompt,
  "id" | "clientId" | "content" | "agent" | "model" | "lastError" | "position"
>

export function toQueuedMessage(item: QueueItem): QueuedMessage {
  return {
    id: item.id,
    clientId: item.clientId ?? undefined,
    content: item.content,
    agent: item.agent,
    model: item.model,
    lastError: item.lastError ?? undefined,
  }
}

export interface QueueInput {
  clientId: string
  content: string
  agent: string
  model: string
}

export class QueueIdConflict extends Error {
  constructor() {
    super("A different prompt already uses this queue request ID")
  }
}

/** One idempotent insert, with the FIFO position allocated by the chat row. */
export async function enqueuePrompt(chatId: string, input: QueueInput): Promise<QueuedPrompt> {
  return prisma.$transaction(async (tx) => {
    // Serialize inserts and imports for this chat before checking clientId.
    // Otherwise two tabs can both observe no row and one gets a unique-key
    // failure instead of the same idempotent result.
    await tx.chat.update({ where: { id: chatId }, data: { queueSequence: { increment: 0 } } })
    const existing = await tx.queuedPrompt.findUnique({
      where: { chatId_clientId: { chatId, clientId: input.clientId } },
    })
    if (existing) {
      if (existing.content !== input.content || existing.agent !== input.agent || existing.model !== input.model) {
        throw new QueueIdConflict()
      }
      return existing
    }

    const chat = await tx.chat.update({
      where: { id: chatId },
      data: { queueSequence: { increment: 1 }, queuePaused: false },
      select: { queueSequence: true },
    })
    return tx.queuedPrompt.create({
      data: {
        chatId,
        clientId: input.clientId,
        position: chat.queueSequence,
        content: input.content,
        agent: input.agent,
        model: input.model,
        userMessageId: randomUUID(),
        assistantMessageId: randomUUID(),
      },
    })
  })
}

/**
 * Idempotently import the old browser queue before clearing localStorage.
 * A retry or a second tab importing the same IDs cannot create duplicates.
 */
export async function importLegacyPrompts(
  chatId: string,
  items: QueueInput[],
  paused: boolean
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.chat.update({ where: { id: chatId }, data: { queueSequence: { increment: 0 } } })
    for (const input of items) {
      const existing = await tx.queuedPrompt.findUnique({
        where: { chatId_clientId: { chatId, clientId: input.clientId } },
      })
      if (existing) {
        if (existing.content !== input.content || existing.agent !== input.agent || existing.model !== input.model) {
          throw new QueueIdConflict()
        }
        continue
      }
      const chat = await tx.chat.update({
        where: { id: chatId },
        data: { queueSequence: { increment: 1 } },
        select: { queueSequence: true },
      })
      await tx.queuedPrompt.create({
        data: {
          chatId,
          clientId: input.clientId,
          position: chat.queueSequence,
          content: input.content,
          agent: input.agent,
          model: input.model,
          userMessageId: randomUUID(),
          assistantMessageId: randomUUID(),
        },
      })
    }
    if (paused && items.length > 0) {
      await tx.chat.update({ where: { id: chatId }, data: { queuePaused: true } })
    }
  })
}

class ClaimLost extends Error {}

/** Atomically reserve a ready chat and its oldest prompt for one worker. */
export async function claimNextPrompt(chatId: string): Promise<QueuedPrompt | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const next = await tx.queuedPrompt.findFirst({
        where: { chatId, status: "queued" },
        orderBy: { position: "asc" },
      })
      if (!next) return null

      const claimedChat = await tx.chat.updateMany({
        where: {
          id: chatId,
          status: "ready",
          backgroundSessionId: null,
          queuePaused: false,
          queueDispatchId: null,
        },
        data: { status: "creating", queueDispatchId: next.id },
      })
      if (claimedChat.count !== 1) throw new ClaimLost()

      const claimedPrompt = await tx.queuedPrompt.updateMany({
        where: { id: next.id, status: "queued" },
        data: { status: "dispatching", claimedAt: new Date(), lastError: null },
      })
      if (claimedPrompt.count !== 1) throw new ClaimLost()
      return { ...next, status: "dispatching" }
    })
  } catch (error) {
    if (error instanceof ClaimLost) return null
    throw error
  }
}

/** A failed start remains queued and visible; manual resume avoids a hot retry loop. */
export async function releaseFailedPrompt(promptId: string, error: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const prompt = await tx.queuedPrompt.findUnique({ where: { id: promptId } })
    if (!prompt || prompt.status !== "dispatching") return
    await tx.queuedPrompt.update({
      where: { id: promptId },
      data: { status: "queued", claimedAt: null, lastError: error.slice(0, 1000) },
    })
    await tx.chat.updateMany({
      where: { id: prompt.chatId, queueDispatchId: promptId },
      data: { status: "ready", queuePaused: true, queueDispatchId: null },
    })
  })
}

/** Reconcile a worker that died before persisting a turn. */
export async function recoverStaleClaims(before: Date): Promise<number> {
  const stale = await prisma.queuedPrompt.findMany({
    where: { status: "dispatching", claimedAt: { lt: before } },
    select: { id: true, chatId: true, userMessageId: true },
  })
  let recovered = 0
  for (const prompt of stale) {
    await prisma.$transaction(async (tx) => {
      const existingMessage = await tx.message.findUnique({
        where: { id: prompt.userMessageId }, select: { id: true },
      })
      const updated = await tx.queuedPrompt.updateMany({
        where: { id: prompt.id, status: "dispatching", claimedAt: { lt: before } },
        data: existingMessage
          ? { status: "started", claimedAt: null }
          : { status: "queued", claimedAt: null, lastError: "Queue worker interrupted before the turn started" },
      })
      if (updated.count !== 1) return
      if (!existingMessage) {
        await tx.chat.updateMany({
          where: { id: prompt.chatId, status: { in: ["creating", "ready", "error"] }, backgroundSessionId: null, queueDispatchId: prompt.id },
          data: { status: "ready", queuePaused: true, queueDispatchId: null },
        })
      }
      recovered++
    })
  }
  return recovered
}
