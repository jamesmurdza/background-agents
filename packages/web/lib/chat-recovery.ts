import type { Chat } from "@/lib/types"
import { applyQueueSnapshot } from "@/lib/queue-sync"
import { toMessageType, type ChatWithMessagesResponse } from "@/lib/sync/api"

/** A recovery read must not undo a send, Stop, or newer turn during its fetch. */
export function applyRecoveredChat(chat: Chat, response: ChatWithMessagesResponse, observed: Chat): Chat {
  if (response.updatedAt < chat.updatedAt || chat.pendingSend || chat.stopPending ||
      chat.status !== observed.status ||
      chat.backgroundSessionId !== observed.backgroundSessionId ||
      chat.activeAssistantMessageId !== observed.activeAssistantMessageId) return chat

  const detail = { ...response, status: response.status as Chat["status"], messages: response.messages.map(toMessageType) }
  const recovered = applyQueueSnapshot(chat, {
    ...detail, queuePaused: !!detail.queuePaused, queuedMessages: detail.queuedMessages ?? [],
    backgroundSessionId: detail.backgroundSessionId ?? null,
    activeAssistantMessageId: detail.activeAssistantMessageId ?? null,
  }, detail)
  return { ...recovered, sessionId: detail.sessionId }
}
