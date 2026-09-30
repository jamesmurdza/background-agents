import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { buildUsageMeta } from "@/lib/server/shared-pool"
import type { MessagePayload } from "./types"

/**
 * Persist the user message + assistant placeholder and flip the chat to
 * "running", all in one transaction. Reuses the client-supplied message IDs
 * (upsert) so optimistic client rows reconcile, and rejects an ID that already
 * belongs to a different chat.
 */
export async function persistTurn(params: {
  chatId: string
  payload: MessagePayload
  agentPrompt: string
  uploadedFilePaths: string[]
  usageMeta: ReturnType<typeof buildUsageMeta>
  backgroundSessionId: string
  isAgentSwitch: boolean
  claimedPromptId?: string
}): Promise<void> {
  const {
    chatId,
    payload,
    agentPrompt,
    uploadedFilePaths,
    usageMeta,
    backgroundSessionId,
    isAgentSwitch,
    claimedPromptId,
  } = params

  const now = Date.now()
  await prisma.$transaction(async (tx) => {
    // Reject reuse of a message ID that already exists in a different
    // chat — the upsert below would otherwise overwrite a foreign row.
    const existing = await tx.message.findMany({
      where: { id: { in: [payload.userMessageId, payload.assistantMessageId] } },
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
        timestamp: BigInt(now),
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

    await tx.message.upsert({
      where: { id: payload.assistantMessageId },
      create: {
        id: payload.assistantMessageId,
        chatId,
        role: "assistant",
        content: "",
        timestamp: BigInt(now + 1),
        agent: payload.agent,
        model: payload.model,
        toolCalls: [],
        contentBlocks: [],
        metadata: { usage: usageMeta } as unknown as Prisma.InputJsonValue,
      },
      update: {
        metadata: { usage: usageMeta } as unknown as Prisma.InputJsonValue,
      },
    })

    const claimedChat = await tx.chat.updateMany({
      where: { id: chatId, status: "creating", queueDispatchId: claimedPromptId ?? null },
      data: {
        status: "running",
        backgroundSessionId,
        queueDispatchId: null,
        lastActiveAt: new Date(),
        // Persist agent/model so subsequent messages on this chat keep them
        agent: payload.agent,
        model: payload.model,
        // Clear stale sessionId on agent switch — new agent will generate its own
        ...(isAgentSwitch && { sessionId: null }),
      },
    })
    if (claimedChat.count !== 1) throw new Error("Chat send claim was lost")

    if (claimedPromptId) {
      const started = await tx.queuedPrompt.updateMany({
        where: { id: claimedPromptId, chatId, status: "dispatching" },
        data: { status: "started", claimedAt: null },
      })
      if (started.count !== 1) throw new Error("Queued prompt claim was lost")
    }
  })
}
