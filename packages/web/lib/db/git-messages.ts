import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { isGitHubApiError } from "@background-agents/common"
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
 * @returns The created message in serialized format (ready for JSON response)
 */
export async function createGitOperationMessage(
  chatId: string,
  content: string,
  isError: boolean = false,
  metadata?: GitOperationMetadata,
  linkBranch?: string
): Promise<GitOperationMessageResponse> {
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

/**
 * Record an auto-push failure, offering a clickable "force push" recovery.
 *
 * Idempotent by design: auto-push runs from several places that can fire for the
 * same completed turn — every open SSE stream (reconnects / multiple tabs) plus
 * the cron lifecycle finalizer. Left unguarded they each append their own
 * "Push failed" line and spam the history with identical errors. So we skip
 * creating a new one when the chat's most recent git-operation message is
 * already an unresolved push failure; a later success (which clears these, see
 * {@link clearPushFailureMessages}) re-arms it.
 *
 * Returns the created message, or null when a duplicate was suppressed.
 */
export async function createPushFailedMessage(
  chatId: string,
  error: string
): Promise<GitOperationMessageResponse | null> {
  const latest = await prisma.message.findFirst({
    where: { chatId, messageType: "git-operation" },
    orderBy: { timestamp: "desc" },
    select: { isError: true, metadata: true },
  })
  const latestMeta = latest?.metadata as GitOperationMetadata | null
  if (latest?.isError && latestMeta?.action === "force-push") {
    // The outstanding failure is still the newest git-operation message —
    // don't stack another identical one on top of it.
    return null
  }

  return createGitOperationMessage(
    chatId,
    `Push failed: ${error}. You can force push to overwrite the remote history.`,
    true,
    { action: "force-push" }
  )
}

/**
 * Remove any outstanding "Push failed" messages for a chat.
 *
 * Called when a push finally lands (successful auto-push or an explicit force
 * push) so the now-stale failure — and its dangling "force push" link — is
 * replaced by the success message rather than lingering above it.
 */
export async function clearPushFailureMessages(chatId: string): Promise<void> {
  await prisma.message.deleteMany({
    where: {
      chatId,
      messageType: "git-operation",
      isError: true,
      metadata: { path: ["action"], equals: "force-push" },
    },
  })
}

/**
 * Logs a failed GitHub-backed git operation (PR creation, squash, ...),
 * records a matching error message in the chat history when a chatId is
 * available, and returns the JSON error response the route should send.
 *
 * @param logTag - Bracketed log prefix, e.g. "github/pr" for `[github/pr] Error: ...`
 * @param error - The caught error, typically a GitHubApiError or Error
 * @param chatId - Chat to record the failure message in, if any
 * @param actionLabel - Human-readable action, e.g. "PR creation" -> "PR creation failed: ...."
 */
export async function reportGitOperationError(
  logTag: string,
  error: unknown,
  chatId: string | null | undefined,
  actionLabel: string
): Promise<Response> {
  console.error(`[${logTag}] Error:`, error)
  const message = isGitHubApiError(error) ? error.message : error instanceof Error ? error.message : "Unknown error"
  const status = isGitHubApiError(error) ? error.status : 500

  if (chatId) {
    await createGitOperationMessage(chatId, `${actionLabel} failed: ${message}.`, true)
  }

  return Response.json({ error: message }, { status })
}
