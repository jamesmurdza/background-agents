// Pure state transforms for chat sync.
//
// Extracted from useChatWithSync (the 1k-line orchestrator hook). These
// functions contain no React, no I/O, and no closures — they are the
// shadow-copy merge, the draft→real migration, the status-transition diff, and
// the message-queue operations that previously lived inline in the hook. Pulling
// them out makes the trickiest bits of the sync logic unit-testable and removes
// the duplicated, error-prone glue (e.g. the four near-identical migration
// blocks) from the hook body.

import type { Chat, ChatStatus, QueuedMessage } from "@/lib/types"
import type { PreviewState } from "@/lib/storage"

/**
 * Client-only chat fields that are layered on top of the server's chat records.
 * Keyed by chat id.
 */
export interface LocalChatState {
  previewStates: Record<string, PreviewState>
  queuedMessages: Record<string, Chat["queuedMessages"]>
  queuePaused: Record<string, boolean>
  drafts: Record<string, string>
}

/**
 * Layer the local-only fields (preview state, queued messages, queue-paused
 * flag) on top of the server chat records to produce the chats the UI renders.
 */
export function mergeLocalState(serverChats: Chat[], local: LocalChatState): Chat[] {
  return serverChats.map((chat) => {
    const previewState = local.previewStates[chat.id]
    return {
      ...chat,
      previewItems: previewState?.items,
      activePreviewIndex: previewState?.activeIndex,
      previewPaneHidden: previewState?.hidden,
      queuedMessages: local.queuedMessages[chat.id],
      queuePaused: local.queuePaused[chat.id],
    }
  })
}

/**
 * Move all local-only state for a chat from one id to another. Used when a draft
 * chat is materialized into a real chat and its draft id changes to the server
 * id. Replaces four near-identical inline blocks in the hook.
 */
export function migrateLocalChatState(
  prev: LocalChatState,
  fromId: string,
  toId: string
): LocalChatState {
  const previewStates = { ...prev.previewStates }
  const queuedMessages = { ...prev.queuedMessages }
  const queuePaused = { ...prev.queuePaused }
  const drafts = { ...prev.drafts }

  if (previewStates[fromId]) {
    previewStates[toId] = previewStates[fromId]
    delete previewStates[fromId]
  }
  if (queuedMessages[fromId]) {
    queuedMessages[toId] = queuedMessages[fromId]
    delete queuedMessages[fromId]
  }
  if (queuePaused[fromId] !== undefined) {
    queuePaused[toId] = queuePaused[fromId]
    delete queuePaused[fromId]
  }
  if (drafts[fromId]) {
    drafts[toId] = drafts[fromId]
    delete drafts[fromId]
  }

  return { previewStates, queuedMessages, queuePaused, drafts }
}

/**
 * Diff the previous per-chat statuses against the current chats to find chats
 * that just finished running (running → non-running) while not being the
 * currently-open chat — these become "unseen" (badged in the sidebar).
 *
 * Returns the ids that newly became unseen plus the next status map to store
 * (which only contains current chats, so stale ids are pruned). Pure: callers
 * own the prevStatuses storage.
 */
export function computeUnseenTransitions(
  chats: Chat[],
  prevStatuses: Map<string, ChatStatus>,
  currentChatId: string | null
): { newlyUnseen: string[]; nextStatuses: Map<string, ChatStatus> } {
  const nextStatuses = new Map<string, ChatStatus>()
  const newlyUnseen: string[] = []

  for (const chat of chats) {
    const prevStatus = prevStatuses.get(chat.id)
    if (prevStatus === "running" && chat.status !== "running" && chat.id !== currentChatId) {
      newlyUnseen.push(chat.id)
    }
    nextStatuses.set(chat.id, chat.status)
  }

  return { newlyUnseen, nextStatuses }
}

// =============================================================================
// Message queue operations
// =============================================================================

/** Append a message to a chat's queue. */
export function enqueue(
  queue: QueuedMessage[] | undefined,
  item: QueuedMessage
): QueuedMessage[] {
  return [...(queue ?? []), item]
}

/** Remove a queued message by id. */
export function removeFromQueue(
  queue: QueuedMessage[] | undefined,
  id: string
): QueuedMessage[] {
  return (queue ?? []).filter((m) => m.id !== id)
}

/** Split the head of a (non-empty) queue from the rest. */
export function dequeue(queue: QueuedMessage[]): { next: QueuedMessage; rest: QueuedMessage[] } {
  const [next, ...rest] = queue
  return { next, rest }
}

/**
 * Whether a chat is in a state where the next queued message may be dispatched.
 * Covers the data-only conditions; in-flight/stream locks are checked by the
 * caller (they're not pure state).
 */
export function isChatReadyForQueueDispatch(
  chat: Pick<Chat, "status" | "backgroundSessionId">,
  queue: QueuedMessage[] | undefined,
  paused: boolean | undefined
): boolean {
  if (!queue || queue.length === 0) return false
  if (paused) return false
  if (chat.status !== "ready" || !!chat.backgroundSessionId) return false
  return true
}

// =============================================================================
// Drafts
// =============================================================================

/**
 * Set or clear a per-chat draft. An empty/undefined draft removes the entry
 * rather than storing a blank string.
 */
export function upsertDraft(
  drafts: Record<string, string>,
  chatId: string,
  draft: string | undefined
): Record<string, string> {
  const next = { ...drafts }
  if (!draft) {
    delete next[chatId]
  } else {
    next[chatId] = draft
  }
  return next
}
