import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"

// =============================================================================
// Types
// =============================================================================

interface MessageResponse {
  id: string
  role: string
  content: string
  timestamp: number
  messageType: string | null
  isError: boolean
  toolCalls: unknown
  contentBlocks: unknown
  uploadedFiles: unknown
  linkBranch: string | null
  metadata: unknown
  agent: string | null
  model: string | null
}

interface ChatWithMessagesResponse {
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
  messages: MessageResponse[]
}

// =============================================================================
// GET - Fetch chat with messages
// =============================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const { searchParams } = new URL(req.url)
    const afterMessageId = searchParams.get("afterMessageId")

    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Fetch messages, optionally after a specific message ID.
    // The afterMessageId lookup must be scoped to this chat: a message ID
    // from another chat would otherwise pull a foreign createdAt and
    // produce wrong pagination boundaries.
    const afterCreatedAt = afterMessageId
      ? (
          await prisma.message.findFirst({
            where: { id: afterMessageId, chatId },
            select: { createdAt: true },
          })
        )?.createdAt
      : undefined

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        ...(afterCreatedAt && {
          createdAt: { gt: afterCreatedAt },
        }),
      },
      orderBy: { timestamp: "asc" },
    })

    const response: ChatWithMessagesResponse = {
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
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: Number(m.timestamp),
        messageType: m.messageType,
        isError: m.isError,
        toolCalls: m.toolCalls,
        contentBlocks: m.contentBlocks,
        uploadedFiles: m.uploadedFiles,
        linkBranch: m.linkBranch,
        metadata: m.metadata,
        agent: m.agent,
        model: m.model,
      })),
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update chat
// =============================================================================

interface PatchChatBody {
  displayName?: string
  status?: string
  agent?: string
  model?: string
  repo?: string
  baseBranch?: string
  branch?: string
  sandboxId?: string
  sessionId?: string
  previewUrlPattern?: string
  backgroundSessionId?: string | null
  needsSync?: boolean
  lastActiveAt?: number
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const body: PatchChatBody = await req.json()

    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Build update data
    const updateData: Record<string, unknown> = {}

    if (body.displayName !== undefined) updateData.displayName = body.displayName
    if (body.status !== undefined) updateData.status = body.status
    if (body.agent !== undefined) updateData.agent = body.agent
    if (body.model !== undefined) updateData.model = body.model
    if (body.repo !== undefined) updateData.repo = body.repo
    if (body.baseBranch !== undefined) updateData.baseBranch = body.baseBranch
    if (body.branch !== undefined) updateData.branch = body.branch
    if (body.sandboxId !== undefined) updateData.sandboxId = body.sandboxId
    if (body.sessionId !== undefined) updateData.sessionId = body.sessionId
    if (body.previewUrlPattern !== undefined) updateData.previewUrlPattern = body.previewUrlPattern
    if (body.backgroundSessionId !== undefined) updateData.backgroundSessionId = body.backgroundSessionId
    if (body.needsSync !== undefined) updateData.needsSync = body.needsSync
    if (body.lastActiveAt !== undefined) updateData.lastActiveAt = new Date(body.lastActiveAt)

    if (Object.keys(updateData).length === 0) {
      return badRequest("No valid fields to update")
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: updateData,
    })

    return Response.json({
      id: updatedChat.id,
      repo: updatedChat.repo,
      baseBranch: updatedChat.baseBranch,
      branch: updatedChat.branch,
      sandboxId: updatedChat.sandboxId,
      sessionId: updatedChat.sessionId,
      previewUrlPattern: updatedChat.previewUrlPattern,
      backgroundSessionId: updatedChat.backgroundSessionId,
      agent: updatedChat.agent,
      model: updatedChat.model,
      displayName: updatedChat.displayName,
      status: updatedChat.status,
      parentChatId: updatedChat.parentChatId,
      needsSync: updatedChat.needsSync,
      createdAt: updatedChat.createdAt.getTime(),
      updatedAt: updatedChat.updatedAt.getTime(),
      lastActiveAt: updatedChat.lastActiveAt.getTime(),
    })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// DELETE - Delete chat and all descendants
// =============================================================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Collect all descendant chat IDs (for cascade delete)
    const collectDescendants = async (rootId: string): Promise<string[]> => {
      const ids: string[] = [rootId]
      const queue = [rootId]

      while (queue.length > 0) {
        const parentId = queue.shift()!
        const children = await prisma.chat.findMany({
          where: { parentChatId: parentId, userId },
          select: { id: true },
        })
        for (const child of children) {
          ids.push(child.id)
          queue.push(child.id)
        }
      }

      return ids
    }

    const chatIdsToDelete = await collectDescendants(chatId)

    // Get sandbox IDs before deletion (for cleanup)
    const chatsWithSandboxes = await prisma.chat.findMany({
      where: { id: { in: chatIdsToDelete } },
      select: { sandboxId: true },
    })
    const sandboxIds = chatsWithSandboxes
      .map((c) => c.sandboxId)
      .filter((id): id is string => id !== null)

    // Delete all chats (messages cascade via onDelete: Cascade)
    await prisma.chat.deleteMany({
      where: { id: { in: chatIdsToDelete } },
    })

    // Log activity (fire and forget)
    logActivityAsync(userId, "chat_deleted", {
      chatId,
      deletedCount: chatIdsToDelete.length,
    })

    // Return the sandbox IDs so client can clean them up
    return Response.json({
      deletedChatIds: chatIdsToDelete,
      sandboxIdsToCleanup: sandboxIds,
    })
  } catch (error) {
    return internalError(error)
  }
}
