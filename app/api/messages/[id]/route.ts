import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
} from "@/lib/api-helpers"
import { INCLUDE_MESSAGE_WITH_BRANCH } from "@/lib/prisma-includes"

// Prevent Next.js from caching this route - always fetch fresh data
export const dynamic = "force-dynamic"

/**
 * GET /api/messages/[id]
 *
 * Fetches a single message with full content.
 * Used for lazy loading message content after initial summary load.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { id: messageId } = await params

  // Fetch message with ownership verification through branch -> repo -> user
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: INCLUDE_MESSAGE_WITH_BRANCH,
  })

  if (!message || message.branch.repo.userId !== userId) {
    return notFound("Message not found")
  }

  // Return message without the nested branch/repo (just the message fields)
  return Response.json({
    message: {
      id: message.id,
      branchId: message.branchId,
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      contentBlocks: message.contentBlocks,
      timestamp: message.timestamp,
      commitHash: message.commitHash,
      commitMessage: message.commitMessage,
      createdAt: message.createdAt,
    },
  })
}
