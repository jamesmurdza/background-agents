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
import { toChatResponse, toMessageResponse } from "@/lib/db/serializers"
import type { ChatWithMessagesResponse, MessageResponse } from "@/lib/sync/api"

// =============================================================================
// Helpers
// =============================================================================

/**
 * Collect a chat and all of its descendant chat ids (breadth-first over the
 * parentChatId tree), scoped to the owner. Shared by DELETE (cascade removal)
 * and PATCH (cascade archive) so the subtree definition stays in one place.
 */
async function collectChatSubtreeIds(rootId: string, userId: string): Promise<string[]> {
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
    const statusOnly = searchParams.get("statusOnly") === "true"

    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // If only status is requested, return minimal response (for SSE reconnection checks)
    if (statusOnly) {
      return Response.json({
        id: chat.id,
        status: chat.status,
        backgroundSessionId: chat.backgroundSessionId,
        sandboxId: chat.sandboxId,
      })
    }

    // Get total message count
    const messageCount = await prisma.message.count({ where: { chatId } })

    // Fetch messages, optionally after a specific message ID (for delta sync).
    // The message ID lookup must be scoped to this chat: a message ID
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

    // When this chat was branched from a parent, the parent's conversation is
    // replayed to the agent for context but isn't stored on this chat. Surface
    // it in the UI too by prepending the parent's user/assistant messages,
    // flagged `inherited` so the client renders them read-only. Only on a full
    // fetch (delta sync via afterMessageId is for this chat's own new messages).
    let inheritedMessages: MessageResponse[] = []
    if (chat.parentChatId && !afterMessageId) {
      const parentMessages = await prisma.message.findMany({
        where: { chatId: chat.parentChatId, role: { in: ["user", "assistant"] } },
        orderBy: { timestamp: "asc" },
      })
      inheritedMessages = parentMessages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          ...toMessageResponse(m),
          id: `inherited-${m.id}`,
          inherited: true,
        }))
    }

    const response: ChatWithMessagesResponse = {
      ...toChatResponse(chat),
      messageCount,
      messages: [
        ...inheritedMessages,
        ...messages.map(toMessageResponse),
      ],
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
  archived?: boolean
  pinned?: boolean
  agent?: string
  model?: string
  planModeEnabled?: boolean
  repo?: string
  baseBranch?: string
  branch?: string
  needsSync?: boolean
  lastActiveAt?: number
  // NOTE: sandboxId, sessionId, previewUrlPattern and backgroundSessionId are
  // intentionally NOT accepted here. They are server-managed — written only by
  // the message/stream flow (ensure-sandbox, persist-turn, persist-snapshot) —
  // and pointer resources that access control now trusts on the chat row (e.g.
  // /api/agent/stream derives the sandbox from the chat row rather than the URL,
  // see e2e/idor.spec.ts). Accepting them from the client would let a user
  // rewrite their own chat to point at another user's sandbox/session and read
  // that victim's agent stream — a mass-assignment path back into the IDOR that
  // fix closed. Keep these off the client-writable surface.
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
    if (body.archived !== undefined) updateData.archived = body.archived
    if (body.pinned !== undefined) updateData.pinned = body.pinned
    if (body.agent !== undefined) updateData.agent = body.agent
    if (body.model !== undefined) updateData.model = body.model
    if (body.planModeEnabled !== undefined) updateData.planModeEnabled = body.planModeEnabled
    if (body.repo !== undefined) updateData.repo = body.repo
    if (body.baseBranch !== undefined) updateData.baseBranch = body.baseBranch
    if (body.branch !== undefined) updateData.branch = body.branch
    // sandboxId / sessionId / previewUrlPattern / backgroundSessionId are
    // deliberately not copied from the body — see PatchChatBody note above.
    if (body.needsSync !== undefined) updateData.needsSync = body.needsSync
    if (body.lastActiveAt !== undefined) updateData.lastActiveAt = new Date(body.lastActiveAt)

    if (Object.keys(updateData).length === 0) {
      return badRequest("No valid fields to update")
    }

    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: updateData,
    })

    // Archiving (or unarchiving) cascades to the whole branch subtree so a
    // parent and its branched children stay together — matching DELETE's
    // cascade. Only the descendants need the extra write; the root was just
    // updated above.
    if (body.archived !== undefined) {
      const subtreeIds = await collectChatSubtreeIds(chatId, userId)
      const descendantIds = subtreeIds.filter((id) => id !== chatId)
      if (descendantIds.length > 0) {
        await prisma.chat.updateMany({
          where: { id: { in: descendantIds }, userId },
          data: { archived: body.archived },
        })
      }
    }

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
      planModeEnabled: updatedChat.planModeEnabled,
      displayName: updatedChat.displayName,
      shareId: updatedChat.shareId,
      status: updatedChat.status,
      archived: updatedChat.archived,
      pinned: updatedChat.pinned,
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
    const chatIdsToDelete = await collectChatSubtreeIds(chatId, userId)

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
