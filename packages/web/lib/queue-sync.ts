import type { Chat, QueuedMessage } from "@/lib/types"
import { ApiError, fetchChat, toMessageType, type PromptQueueResponse } from "@/lib/sync/api"
import { mergeMessages } from "@/lib/merge-messages"
import { acknowledgeDirectSends } from "@/lib/direct-send-recovery"

export function queueSyncFailure(error: unknown) {
  return {
    syncError: error instanceof Error ? error.message : "Could not reach the server",
    // Authentication, request timeouts and rate limits can recover without
    // changing the prompt. Invalid/forbidden requests must not retry forever.
    syncFailed: error instanceof ApiError && error.status >= 400 && error.status < 500 &&
      ![401, 408, 429].includes(error.status),
  }
}

/** A queue item must not vanish before its user/assistant rows arrive. */
type QueueSnapshot = Pick<Chat, "queuedMessages" | "activeAssistantMessageId" | "backgroundSessionId" | "messageCount" | "lastMessageId">
export function needsQueueMessages(previous: Chat | undefined, next: QueueSnapshot, local: QueuedMessage[] = []): boolean {
  if (!previous) return false
  const ids = new Set(next.queuedMessages?.map((item) => item.id))
  return !!previous.queuedMessages?.some((item) => !ids.has(item.id)) ||
    (next.messageCount !== undefined && next.messageCount !== previous.messageCount) ||
    (!!next.lastMessageId && !previous.messages.some((message) => message.id === next.lastMessageId)) ||
    local.some((item) => !item.directSend && !item.cancelRequested && !!item.userMessageId &&
      !previous.messages.some((message) => message.id === item.userMessageId) &&
      !next.queuedMessages?.some((queued) => queued.clientId === item.id || queued.userMessageId === item.userMessageId)) ||
    (!!next.activeAssistantMessageId && !previous.messages.some((message) => message.id === next.activeAssistantMessageId)) ||
    (!!previous.backgroundSessionId && !next.backgroundSessionId)
}

/** Sidebar metadata must not eagerly fetch histories for every unopened chat. */
export function needsChatListMessages(previous: Chat | undefined, next: QueueSnapshot): boolean {
  return !!previous?.messages.length && needsQueueMessages(previous, next)
}

/** Fetch before changing queue visibility; failed reads leave the old UI intact. */
export async function loadQueueMessages(chatId: string) {
  const detail = await fetchChat(chatId)
  acknowledgeDirectSends(chatId, detail.messages)
  return { ...detail, status: detail.status as Chat["status"], messages: detail.messages.map(toMessageType) }
}

/** Error text is local, but must not disappear on a poll or leak to a new turn. */
export function snapshotFailure(chat: Chat, next: {
  status: Chat["status"]
  activeAssistantMessageId?: string | null
  lastMessageId?: string | null
  backgroundSessionId?: string | null
}) {
  const previousOwner = chat.activeAssistantMessageId || chat.lastMessageId || chat.messages.at(-1)?.id
  const nextOwner = next.activeAssistantMessageId || next.lastMessageId
  const sameTurn = nextOwner ? nextOwner === previousOwner :
    (next.backgroundSessionId ?? undefined) === chat.backgroundSessionId && !next.activeAssistantMessageId
  const keep = !chat.pendingSend && sameTurn &&
    (chat.status === "error" || chat.status === "disconnected") &&
    (next.status === "error" || next.status === "disconnected")
  return { errorMessage: keep ? chat.errorMessage : undefined, errorKind: keep ? chat.errorKind : undefined }
}

export function applyQueueSnapshot(
  chat: Chat,
  remote: PromptQueueResponse,
  detail?: Awaited<ReturnType<typeof loadQueueMessages>>,
): Chat {
  // detail was read later than remote. Never overwrite it with the older poll.
  const state = detail ?? remote
  if (state.updatedAt !== undefined && state.updatedAt < chat.updatedAt) return chat
  const messages = detail ? mergeMessages(chat.messages, detail.messages) : chat.messages
  const ids = new Set(messages.map((message) => message.id))
  // A list/queue response can describe the chat before a direct send has
  // reached the server. Keep the local submission visible until its POST
  // resolves, without comparing client time with the server's clock.
  const awaitingSend = chat.pendingSend && (state.status === "pending" || state.status === "ready")
  const recoverableAssistantMessageId = state.status === "error" && state.updatedAt === remote.updatedAt
    ? remote.recoverableAssistantMessageId !== undefined
      ? remote.recoverableAssistantMessageId ?? undefined
      : state.updatedAt === chat.updatedAt ? chat.recoverableAssistantMessageId : undefined
    : undefined
  return {
    ...chat,
    updatedAt: state.updatedAt ?? chat.updatedAt,
    status: awaitingSend ? chat.status : state.status,
    queuePaused: state.queuePaused,
    queuedMessages: (state.queuedMessages ?? []).filter((item) => !item.userMessageId || !ids.has(item.userMessageId)),
    sandboxId: state.sandboxId,
    backgroundSessionId: state.backgroundSessionId ?? undefined,
    activeAssistantMessageId: state.activeAssistantMessageId ?? (chat.pendingSend ? chat.activeAssistantMessageId : undefined),
    messages,
    messageCount: state.messageCount ?? chat.messageCount,
    lastMessageId: state.lastMessageId ?? chat.lastMessageId,
    uncommittedFilesCount: detail?.uncommittedFilesCount ?? chat.uncommittedFilesCount,
    ...snapshotFailure(chat, state),
    recoverableAssistantMessageId,
  }
}
