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
      status: true, queuePaused: true, sandboxId: true, backgroundSessionId: true,
      queuedPrompts: {
        where: { status: { in: ["queued", "dispatching"] } },
        orderBy: { position: "asc" },
      },
    },
  })
  return Response.json({
    status: chat.status,
    queuePaused: chat.queuePaused,
    sandboxId: chat.sandboxId,
    backgroundSessionId: chat.backgroundSessionId,
    queuedMessages: chat.queuedPrompts.map(toQueuedMessage),
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
      await importLegacyPrompts(chatId, items as QueueInput[], body.paused === true)
      return Response.json({ imported: items.length })
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
  let body: { paused?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body.paused !== "boolean") {
    return Response.json({ error: "paused must be a boolean" }, { status: 400 })
  }
  await prisma.chat.update({ where: { id: chatId }, data: { queuePaused: body.paused } })
  return Response.json({ queuePaused: body.paused })
}
