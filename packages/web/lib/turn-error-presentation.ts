import type { Chat } from "./types"
import { readFailureMarker, TURN_STARTUP_TIMEOUT_REASON } from "./turn-failure-marker"

export function unsupportedModelFailure(reason: string | undefined): string | undefined {
  if (reason && /\bmodel\b(?:\s+['"]?[\w./:-]+['"]?)?\s+(?:is\s+)?not\s+supported\b|unsupported\s+model/i.test(reason)) {
    return "This model is not supported in this session. Choose another model before retrying."
  }
}

export function latestFailedAssistant(chat: Chat) {
  if (chat.status !== "error" || chat.pendingSend || chat.stopPending ||
      chat.backgroundSessionId || chat.activeAssistantMessageId) return
  let message = chat.messages.at(-1)
  if (message?.role !== "assistant") return
  if (message.isError || message.messageType === "error") {
    // Cron appends a separate notice after this exact assistant. Never scan
    // arbitrary history: an older failed turn must not explain a newer one.
    const previous = chat.messages.at(-2)
    if (previous?.role !== "assistant" || message.id !== `${previous.id}:error`) return
    message = previous
  }
  if (message.isError || message.messageType === "error") return
  const marker = readFailureMarker(message.metadata?.turnFinalization, message.id)
  if (marker?.executionStopped) return message
}

/** Read only the latest confirmed failed turn, never an older failure or a
 * still-running execution. Never show the process output a crash attaches. */
export function persistedProviderFailure(chat: Chat): string | undefined {
  const message = latestFailedAssistant(chat)
  const marker = message?.metadata?.turnFinalization
  if (!marker) return
  if (marker.reason === TURN_STARTUP_TIMEOUT_REASON && message.metadata?.launchError) {
    return message.metadata.launchError
  }
  if (/ProviderHeaderTimeoutError|provider response headers timed out/i.test(marker.reason)) {
    return "The model provider did not respond in time. Try again, or choose another model before retrying."
  }
  const unsupported = unsupportedModelFailure(marker.reason)
  if (unsupported) return unsupported
  if (/ProviderModelNotFoundError|model[^\n]*(?:not found|not available|unavailable)/i.test(marker.reason)) {
    return "This model is no longer available. Choose another model before retrying."
  }
  // The SDK already wrote a user-facing message; a crash appends its process
  // output after a blank line.
  return marker.reason.split("\n\n")[0]
}
