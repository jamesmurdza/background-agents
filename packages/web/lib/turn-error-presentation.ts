import type { Chat } from "./types"

/** Read only the latest confirmed failed turn, never an older failure or a
 * still-running execution. Do not expose arbitrary persisted process logs. */
export function persistedProviderFailure(chat: Chat): string | undefined {
  if (chat.status !== "error" || chat.pendingSend || chat.stopPending ||
      chat.backgroundSessionId || chat.activeAssistantMessageId) return
  const message = chat.messages.at(-1)
  if (message?.role !== "assistant" || message.messageType === "error") return
  const marker = message.metadata?.turnFinalization
  if (marker?.state !== "error" || marker.executionStopped !== true ||
      marker.assistantMessageId !== message.id || !marker.backgroundSessionId ||
      typeof marker.reason !== "string") return
  if (/ProviderHeaderTimeoutError|provider response headers timed out/i.test(marker.reason)) {
    return "The model provider did not respond in time. Try again, or choose another model before retrying."
  }
  if (/ProviderModelNotFoundError|model[^\n]*(?:not found|not available|unavailable)/i.test(marker.reason)) {
    return "This model is no longer available. Choose another model before retrying."
  }
}
