import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import { toChatResponse } from "@/lib/db/serializers"
import type { ChatResponse } from "@/lib/sync/api"
import {
  agentModels,
  getDefaultAgent,
  resolveAgent,
  resolveModelForAgent,
  hasCredentialsForModel,
  type Agent,
} from "@background-agents/common"
import { getEffectiveCredentialFlags } from "@/lib/server/credential-flags"

// =============================================================================
// GET - List all chats for user
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { searchParams } = new URL(req.url)
    const updatedAfter = searchParams.get("updatedAfter")

    const chats = await prisma.chat.findMany({
      where: {
        userId,
        // Exclude chats linked to scheduled job runs (they show in Scheduled Jobs UI)
        scheduledJobRun: null,
        ...(updatedAfter && {
          updatedAt: { gt: new Date(parseInt(updatedAfter)) },
        }),
      },
      include: {
        messages: {
          select: { id: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { lastActiveAt: "desc" },
    })

    const response: ChatResponse[] = chats.map((chat) => ({
      ...toChatResponse(chat),
      messageCount: chat._count.messages,
      lastMessageId: chat.messages[0]?.id ?? null,
    }))

    return Response.json({ chats: response })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// POST - Create a new chat
// =============================================================================

interface CreateChatBody {
  repo: string
  baseBranch?: string
  parentChatId?: string
  agent?: string
  model?: string
  status?: string
  planModeEnabled?: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateChatBody = await req.json()

    if (!body.repo) {
      return badRequest("repo is required")
    }

    // Validate parentChatId if provided
    if (body.parentChatId) {
      const parentChat = await prisma.chat.findUnique({
        where: { id: body.parentChatId },
        select: { userId: true },
      })
      if (!parentChat || parentChat.userId !== userId) {
        return badRequest("Invalid parentChatId")
      }
    }

    // Pick an (agent, model) pair that's actually usable with the user's
    // credentials. Without this the row could have e.g. agent="opencode"
    // (the hardcoded default) but model="claude-sonnet-..." (settings'
    // default), which is internally inconsistent and confuses the UI.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    })
    const userSettings = (user?.settings as { defaultAgent?: string; defaultModel?: string } | null) ?? {}
    const { flags } = await getEffectiveCredentialFlags(userId)

    const requestedAgent = resolveAgent(body.agent, userSettings.defaultAgent)
    const requestedAgentUsable = (agentModels[requestedAgent] ?? []).some((m) =>
      hasCredentialsForModel(m, flags, requestedAgent)
    )
    const finalAgent: Agent = requestedAgentUsable
      ? requestedAgent
      : getDefaultAgent()

    const finalModel: string =
      body.model ?? resolveModelForAgent(finalAgent, flags, userSettings.defaultModel)

    const chat = await prisma.chat.create({
      data: {
        userId,
        repo: body.repo,
        baseBranch: body.baseBranch ?? "main",
        parentChatId: body.parentChatId,
        agent: finalAgent,
        model: finalModel,
        status: body.status ?? "pending",
        planModeEnabled: body.planModeEnabled ?? false,
      },
    })

    const response: ChatResponse = {
      ...toChatResponse(chat),
      messageCount: 0,
      lastMessageId: null,
    }

    // Log activity (fire and forget)
    logActivityAsync(userId, "chat_created", {
      chatId: chat.id,
      repo: chat.repo,
      agent: chat.agent,
      model: chat.model ?? undefined,
    })

    return Response.json(response, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
