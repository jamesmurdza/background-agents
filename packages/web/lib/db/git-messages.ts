import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { prisma } from "@/lib/db/prisma"

/**
 * Metadata for git operation messages.
 * Used to provide action hints for the frontend (e.g., making "force push" clickable).
 */
export interface GitOperationMetadata {
  action?: "force-push" | "view-pr" | "view-branch"
  prUrl?: string
  prNumber?: number
}

/**
 * Serialized message format returned to the frontend.
 * BigInt timestamp is converted to number for JSON serialization.
 */
export interface GitOperationMessageResponse {
  id: string
  role: "assistant"
  content: string
  timestamp: number
  messageType: "git-operation"
  isError: boolean
  metadata: GitOperationMetadata | null
  linkBranch: string | null
}

/**
 * Creates a git-operation message in the database.
 * Used for merge, rebase, force-push, squash, PR creation, and abort operations.
 *
 * @param chatId - The chat ID to add the message to
 * @param content - The message content (e.g., "Merged feature-x into main.")
 * @param isError - Whether this is an error message
 * @param metadata - Optional metadata for actions/links
 * @param linkBranch - Optional branch name for linking to GitHub
 * @param options - Additional options
 * @param options.dedupeKey - If provided, prevents duplicate messages with the same key within 30 seconds
 * @returns The created message in serialized format (ready for JSON response), or null if deduplicated
 */
export async function createGitOperationMessage(
  chatId: string,
  content: string,
  isError: boolean = false,
  metadata?: GitOperationMetadata,
  linkBranch?: string,
  options?: { dedupeKey?: string }
): Promise<GitOperationMessageResponse | null> {
  // Check for recent duplicate if dedupeKey is provided
  if (options?.dedupeKey) {
    const thirtySecondsAgo = BigInt(Date.now() - 30000)
    const existingMessage = await prisma.message.findFirst({
      where: {
        chatId,
        messageType: "git-operation",
        content: { startsWith: options.dedupeKey },
        timestamp: { gte: thirtySecondsAgo },
      },
      orderBy: { timestamp: "desc" },
    })
    if (existingMessage) {
      // Return null to indicate message was deduplicated
      return null
    }
  }

  const message = await prisma.message.create({
    data: {
      id: nanoid(),
      chatId,
      role: "assistant",
      content,
      timestamp: BigInt(Date.now()),
      messageType: "git-operation",
      isError,
      metadata: metadata as Prisma.InputJsonValue,
      linkBranch,
    },
  })
  return {
    id: message.id,
    role: "assistant",
    content: message.content,
    timestamp: Number(message.timestamp),
    messageType: "git-operation",
    isError: message.isError,
    metadata: message.metadata as GitOperationMetadata | null,
    linkBranch: message.linkBranch,
  }
}
