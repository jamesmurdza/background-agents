import type { Chat, Message, QueuedMessage } from "@/lib/types"
import { fetchChat, toMessageType, type PromptQueueResponse } from "@/lib/sync/api"
import { mergeMessages } from "@/lib/merge-messages"

/** A queue item must not vanish before its user/assistant rows arrive. */
type QueueSnapshot = Pick<Chat, "queuedMessages" | "activeAssistantMessageId" | "backgroundSessionId" | "messageCount" | "lastMessageId"> &
  Partial<Pick<Chat, "status" | "updatedAt">>
export function needsQueueMessages(previous: Chat | undefined, next: QueueSnapshot, local: QueuedMessage[] = []): boolean {
  if (!previous) return false
  const ids = new Set(next.queuedMessages?.map((item) => item.id))
  return !!previous.queuedMessages?.some((item) => !ids.has(item.id)) ||
    // A finalizer can add the useful failure reason without adding a message
    // or changing its content. Fetch that newer error revision once, not on
    // every unchanged queue poll.
    (next.status === "error" && next.updatedAt !== undefined && next.updatedAt > previous.updatedAt) ||
    (next.messageCount !== undefined && next.messageCount !== previous.messageCount) ||
    (!!next.lastMessageId && !previous.messages.some((message) => message.id === next.lastMessageId)) ||
    local.some((item) => !!item.userMessageId &&
      !previous.messages.some((message) => message.id === item.userMessageId) &&
      !next.queuedMessages?.some((queued) => queued.clientId === item.id || queued.userMessageId === item.userMessageId)) ||
    (!!next.activeAssistantMessageId && !previous.messages.some((message) => message.id === next.activeAssistantMessageId)) ||
    (!!previous.backgroundSessionId && !next.backgroundSessionId)
}

/** Sidebar metadata must not eagerly fetch histories for every unopened chat. */
export function needsChatListMessages(previous: Chat | undefined, next: QueueSnapshot): boolean {
  return !!previous?.messages.length && needsQueueMessages(previous, next)
}

function toDetail(response: Awaited<ReturnType<typeof fetchChat>>, messages: Message[]) {
  return { ...response, status: response.status as Chat["status"], messages }
}

/**
 * A delta is only trusted if, merged into what we already have, it accounts
 * for every message the server counts. Otherwise something was missed (a
 * dropped local copy, an older sync point) and a full read repairs it.
 */
export function deltaCoversHistory(existing: Message[], delta: Message[], serverCount: number): boolean {
  return mergeMessages(existing, delta).filter((message) => !message.inherited).length >= serverCount
}

/**
 * Fetch before changing queue visibility; failed reads leave the old UI intact.
 * When `previous` has already synced its history, only messages changed since
 * then are downloaded; the full history is read only as a fallback.
 */
export async function loadQueueMessages(chatId: string, previous?: Chat) {
  const since = previous?.messages.length ? previous.messagesSyncedAt : undefined
  if (previous && since !== undefined) {
    const delta = await fetchChat(chatId, { changedSince: since })
    const messages = delta.messages.map(toMessageType)
    if (delta.syncedAt !== undefined && deltaCoversHistory(previous.messages, messages, delta.messageCount)) {
      return toDetail(delta, messages)
    }
  }
  const detail = await fetchChat(chatId)
  return toDetail(detail, detail.messages.map(toMessageType))
}

/**
 * For a poll that skipped the history read: apply queue/status, but keep the
 * old message counters so the read still happens once it is no longer skipped.
 */
export function withoutMessageProgress(remote: PromptQueueResponse): PromptQueueResponse {
  return { ...remote, messageCount: undefined, lastMessageId: undefined }
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
    messagesSyncedAt: detail?.syncedAt ?? chat.messagesSyncedAt,
    uncommittedFilesCount: detail?.uncommittedFilesCount ?? chat.uncommittedFilesCount,
    hasCommits: detail?.hasCommits ?? chat.hasCommits,
    ...snapshotFailure(chat, state),
    recoverableAssistantMessageId,
  }
}
