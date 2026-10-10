import type { QueuedMessage } from "./types"
import { setQueuedMessages } from "./storage"
import { useChatSyncStore } from "./stores/chat-sync-store"
import { useToastStore } from "./stores/toast-store"

// Reuse the per-message device storage, not the server queue. Every importer,
// queue presentation and dispatcher must exclude records carrying directSend.
function updateRecovery(chatId: string, update: (items: QueuedMessage[]) => QueuedMessage[]) {
  const previous = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
  let next = update(previous)
  let persisted = true
  try {
    next = setQueuedMessages(chatId, next.length ? next : undefined, previous)
  } catch (error) {
    persisted = false
    console.error("Could not retain direct send on this device:", error)
    useToastStore.getState().addToast({ title: "Could not save this prompt on this device", body: "Keep this tab open and copy the prompt before reloading.", chatId })
  }
  useChatSyncStore.getState().setLocalChatState((local) => ({
    ...local, queuedMessages: { ...local.queuedMessages, [chatId]: next.length ? next : undefined },
  }))
  return persisted
}

export function retainDirectSend(chatId: string, item: QueuedMessage) {
  return updateRecovery(chatId, (items) => [...items.filter((entry) => entry.id !== item.id), item])
}

export function markDirectSendUnconfirmed(chatId: string, id: string, error: string) {
  updateRecovery(chatId, (items) => items.map((item) => item.id === id && item.directSend
    ? { ...item, directSend: { ...item.directSend, error } } : item))
}

/** Dismissal only removes the device copy. It never cancels a server execution. */
export function dismissDirectSend(chatId: string, id: string) {
  updateRecovery(chatId, (items) => items.filter((item) => item.id !== id || !item.directSend))
}

/** Call only with a fresh server response, never optimistic/merged cache rows. */
export function acknowledgeDirectSends(chatId: string, messages: { id: string; role: string }[]) {
  const acknowledged = new Set(messages.filter((message) => message.role === "user").map((message) => message.id))
  const pending = useChatSyncStore.getState().localChatState.queuedMessages[chatId] ?? []
  if (!pending.some((item) => item.directSend && acknowledged.has(item.userMessageId ?? item.id))) return
  updateRecovery(chatId, (items) => items.filter((item) => !item.directSend || !acknowledged.has(item.userMessageId ?? item.id)))
}
