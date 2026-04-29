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
 * Creates a git-operation message in the database.
 * Used for merge, rebase, force-push, squash, PR creation, and abort operations.
 *
 * @param chatId - The chat ID to add the message to
 * @param content - The message content (e.g., "Merged feature-x into main.")
 * @param isError - Whether this is an error message
 * @param metadata - Optional metadata for actions/links
 * @param linkBranch - Optional branch name for linking to GitHub
 * @returns The created message ID
 */
export async function createGitOperationMessage(
  chatId: string,
  content: string,
  isError: boolean = false,
  metadata?: GitOperationMetadata,
  linkBranch?: string
): Promise<string> {
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
  return message.id
}
