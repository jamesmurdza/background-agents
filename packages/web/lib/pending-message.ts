// Pending message persistence across the OAuth sign-in redirect.
//
// When an unauthenticated user composes a message and hits send, we stash the
// message in sessionStorage, send them through the GitHub OAuth flow, and then
// replay it once they return authenticated. Kept in its own module so the logic
// is pure and unit-testable, independent of any React component.

// Storage key for pending message (persists across OAuth redirect)
export const PENDING_MESSAGE_KEY = "simple-chat-pending-message"

// Type for pending message data stored before sign-in
export interface PendingMessage {
  message: string
  agent: string
  model: string
}

// Save pending message to sessionStorage
export function savePendingMessage(data: PendingMessage): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(data))
  }
}

// Load and clear pending message from sessionStorage
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

// Whether a pending message is currently staged (without consuming it).
export function hasPendingMessage(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(PENDING_MESSAGE_KEY) !== null
}
