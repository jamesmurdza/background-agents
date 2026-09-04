/**
 * Server-side serializers that turn Prisma rows into the wire shapes the sync
 * API returns. Kept in one place so the field mapping (and the date/bigint
 * conversions) stay consistent across the chat routes that emit them.
 */

import type { Chat, Message } from "@prisma/client"
import type { ChatResponse, MessageResponse } from "@/lib/sync/api"

/**
 * Serialize a Prisma {@link Chat} row into the base wire shape, converting
 * Date columns to epoch-ms numbers. The message-derived fields (`messageCount`,
 * `lastMessageId`, `messages`) are left to the caller since they depend on the
 * query's includes.
 */
export function toChatResponse(chat: Chat): ChatResponse {
  return {
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
    planModeEnabled: chat.planModeEnabled,
    displayName: chat.displayName,
    shareId: chat.shareId,
    status: chat.status,
    archived: chat.archived,
    pinned: chat.pinned,
    parentChatId: chat.parentChatId,
    needsSync: chat.needsSync,
    createdAt: chat.createdAt.getTime(),
    updatedAt: chat.updatedAt.getTime(),
    lastActiveAt: chat.lastActiveAt.getTime(),
  }
}

/**
 * Serialize a Prisma {@link Message} row into the wire shape, converting the
 * bigint `timestamp` to a number. Callers that emit inherited (parent-chat)
 * messages override `id`/`inherited` on the result.
 */
export function toMessageResponse(message: Message): MessageResponse {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: Number(message.timestamp),
    messageType: message.messageType,
    isError: message.isError,
    toolCalls: message.toolCalls,
    contentBlocks: message.contentBlocks,
    uploadedFiles: message.uploadedFiles,
    linkBranch: message.linkBranch,
    metadata: message.metadata,
    agent: message.agent,
    model: message.model,
  }
}
