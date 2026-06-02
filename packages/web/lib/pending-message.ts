/**
 * Pending message persistence
 *
 * When an unauthenticated user tries to send a message, we stash it in
 * sessionStorage before redirecting to the OAuth sign-in flow. After the
 * redirect completes, the message is loaded back and replayed automatically.
 */

// Storage key for pending message (persists across OAuth redirect)
const PENDING_MESSAGE_KEY = "simple-chat-pending-message"

// Type for pending message data stored before sign-in
export interface PendingMessage {
  message: string
  agent: string
  model: string
}

/** Save a pending message to sessionStorage (no-op during SSR). */
export function savePendingMessage(data: PendingMessage): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(data))
  }
}

/** Whether a pending message is currently stored (no-op-safe during SSR). */
export function hasPendingMessage(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(PENDING_MESSAGE_KEY) !== null
}

/**
 * Load and remove the pending message from sessionStorage.
 * Returns null when there is nothing stored or the value is unparseable.
 */
export function loadAndClearPendingMessage(): PendingMessage | null {
  if (typeof window === "undefined") return null
  const stored = sessionStorage.getItem(PENDING_MESSAGE_KEY)
  if (stored) {
    sessionStorage.removeItem(PENDING_MESSAGE_KEY)
    try {
      return JSON.parse(stored) as PendingMessage
    } catch {
      return null
    }
  }
  return null
}
