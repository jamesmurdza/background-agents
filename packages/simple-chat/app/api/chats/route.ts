import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// Types
// =============================================================================

interface ChatResponse {
  id: string
  repo: string
  baseBranch: string
  branch: string | null
  sandboxId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string | null
  agent: string
  model: string | null
  displayName: string | null
  status: string
  parentChatId: string | null
  needsSync: boolean
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  messageCount: number
  lastMessageId: string | null
}

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
      id: chat.id,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      agent: chat.agent,
      model: chat.model,
      displayName: chat.displayName,
      status: chat.status,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
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

    const chat = await prisma.chat.create({
      data: {
        userId,
        repo: body.repo,
        baseBranch: body.baseBranch ?? "main",
        parentChatId: body.parentChatId,
        agent: body.agent ?? "opencode",
        model: body.model,
        status: body.status ?? "pending",
      },
    })

    const response: ChatResponse = {
      id: chat.id,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      agent: chat.agent,
      model: chat.model,
      displayName: chat.displayName,
      status: chat.status,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
      messageCount: 0,
      lastMessageId: null,
    }

    return Response.json(response, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
