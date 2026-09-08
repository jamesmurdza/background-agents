import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { MessagePayload } from "./types"

/**
 * Persist ONLY the user's message, for a turn that is being held while the
 * environment's setup script runs.
 *
 * The turn is dispatched later, from an already-persisted message, by the
 * /setup SSE endpoint or the agent-lifecycle cron. If the message were not
 * written before the handler returns, a client that disconnects would lose the
 * user's message entirely and the cron backstop would have nothing to dispatch.
 *
 * Deliberately narrower than {@link persistTurn}:
 *  - No assistant placeholder. `buildAgentHistory` decides both agent-switch
 *    and fork-history replay from the most recent *assistant* message, so
 *    writing a placeholder here would make a forked chat's first turn lose its
 *    parent's history.
 *  - No `chat.status` write. The chat is in `setting_up` and only the atomic
 *    claim in `dispatchQueuedTurn` may move it out.
 *
 * Keeps persistTurn's foreign-id guard: an id belonging to another chat would
 * otherwise be overwritten by the upsert.
 */
export async function persistQueuedUserMessage(params: {
  chatId: string
  payload: MessagePayload
  agentPrompt: string
  uploadedFilePaths: string[]
}): Promise<void> {
  const { chatId, payload, agentPrompt, uploadedFilePaths } = params

  await prisma.$transaction(async (tx) => {
    const existing = await tx.message.findMany({
      where: { id: payload.userMessageId },
      select: { id: true, chatId: true },
    })
    for (const m of existing) {
      if (m.chatId !== chatId) {
        throw new Error("Message ID belongs to a different chat")
      }
    }

    await tx.message.upsert({
      where: { id: payload.userMessageId },
      create: {
        id: payload.userMessageId,
        chatId,
        role: "user",
        content: agentPrompt,
        timestamp: BigInt(Date.now()),
        agent: payload.agent,
        model: payload.model,
        uploadedFiles:
          uploadedFilePaths.length > 0
            ? (uploadedFilePaths as unknown as Prisma.InputJsonValue)
            : undefined,
      },
      update: {
        content: agentPrompt,
        agent: payload.agent,
        model: payload.model,
        uploadedFiles:
          uploadedFilePaths.length > 0
            ? (uploadedFilePaths as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    })
  })
}
