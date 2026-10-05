import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"
import {
  enqueuePrompt,
  importLegacyPrompts,
  QueueIdConflict,
  toQueuedMessage,
  type QueueInput,
} from "@/lib/server/prompt-queue"
import { getDefaultModelForAgent, type Agent } from "@background-agents/common"
import { readTerminalQueueRecovery, recoverTerminalQueue } from "@/lib/server/queue-recovery"

type Params = { params: Promise<{ chatId: string }> }

function validInput(value: unknown, fallbackAgent?: string, fallbackModel?: string): QueueInput | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const content = typeof v.content === "string" ? v.content.trim() : ""
  const clientId = typeof v.clientId === "string" ? v.clientId : ""
  const agent = typeof v.agent === "string" && v.agent ? v.agent : fallbackAgent
  const model = typeof v.model === "string" && v.model ? v.model : fallbackModel
  if (!clientId || clientId.length > 128 || !content || content.length > 100_000 || !agent || !model) return null
  return { clientId, content, agent, model }
}

async function authorizedChat(chatId: string) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return { error: auth }
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return { error: notFound("Chat not found") }
  return { chat }
}

/** Current queue state for a chat, used to sync independent browsers. */
export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const { chatId } = await params
  const auth = await authorizedChat(chatId)
  if (auth.error) return auth.error
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: chatId },
    select: {
      updatedAt: true,
      status: true, queuePaused: true, sandboxId: true, backgroundSessionId: true, activeAssistantMessageId: true,
      _count: { select: { messages: true } },
      messages: { orderBy: { timestamp: "desc" }, take: 1, select: { id: true } },
      queuedPrompts: {
        where: { status: { in: ["queued", "dispatching"] } },
        orderBy: { position: "asc" },
      },
    },
  })
  const recovery = chat.status === "error" ? await readTerminalQueueRecovery(chatId) : null
  return Response.json({
    updatedAt: chat.updatedAt.getTime(),
    messageCount: chat._count.messages,
    lastMessageId: chat.messages[0]?.id ?? null,
    status: chat.status,
    queuePaused: chat.queuePaused,
    sandboxId: chat.sandboxId,
    backgroundSessionId: chat.backgroundSessionId,
    activeAssistantMessageId: chat.activeAssistantMessageId,
    queuedMessages: chat.queuedPrompts.map(toQueuedMessage),
    recoverableAssistantMessageId: recovery?.updatedAt === chat.updatedAt.getTime() ? recovery.assistantMessageId : null,
  })
}

/** Enqueue a new prompt or idempotently import a browser's old local queue. */
export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const { chatId } = await params
  const auth = await authorizedChat(chatId)
  if (auth.error) return auth.error
  const chat = auth.chat!
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    if (Array.isArray(body.legacyItems)) {
      if (body.legacyItems.length > 100) {
        return Response.json({ error: "Too many queued prompts" }, { status: 400 })
      }
      const fallbackModel = chat.model ?? getDefaultModelForAgent(chat.agent as Agent, null)
      const items = body.legacyItems.map((item) => validInput(item, chat.agent, fallbackModel))
      if (items.some((item) => !item)) {
        return Response.json({ error: "Invalid queued prompt" }, { status: 400 })
      }
      const imported = await importLegacyPrompts(chatId, items as QueueInput[], body.paused === true)
      return Response.json({ imported: items.length, queuedMessages: imported.map(toQueuedMessage) })
    }

    const input = validInput(body)
    if (!input) return Response.json({ error: "Invalid queued prompt" }, { status: 400 })
    const item = await enqueuePrompt(chatId, input)
    return Response.json({ queuedMessage: toQueuedMessage(item) }, { status: 201 })
  } catch (error) {
    if (error instanceof QueueIdConflict) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    console.error("[queue] Failed to enqueue prompt:", error)
    return Response.json({ error: "Failed to save queued prompt" }, { status: 500 })
  }
}

/** Pause or resume server-side dispatch. */
export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { chatId } = await params
  const auth = await authorizedChat(chatId)
  if (auth.error) return auth.error
  let body: { paused?: unknown; recoverTerminal?: unknown; updatedAt?: unknown; assistantMessageId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body.paused !== "boolean") {
    return Response.json({ error: "paused must be a boolean" }, { status: 400 })
  }
  if (body.recoverTerminal === true) {
    if (body.paused || typeof body.updatedAt !== "number" || !Number.isSafeInteger(body.updatedAt) || body.updatedAt < 0 ||
        typeof body.assistantMessageId !== "string" || !body.assistantMessageId || body.assistantMessageId.length > 200) {
      return Response.json({ error: "Invalid terminal recovery request" }, { status: 400 })
    }
    const recovered = await recoverTerminalQueue(chatId, { updatedAt: body.updatedAt, assistantMessageId: body.assistantMessageId })
    if (!recovered) return Response.json({ error: "The failed turn cannot be safely continued yet. Reload the chat." }, { status: 409 })
    return Response.json({ queuePaused: false })
  }
  await prisma.chat.update({ where: { id: chatId }, data: { queuePaused: body.paused } })
  return Response.json({ queuePaused: body.paused })
}
