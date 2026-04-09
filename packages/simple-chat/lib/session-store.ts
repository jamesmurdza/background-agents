/**
 * Simple in-memory session store
 * Maps sandboxId -> backgroundSessionId
 *
 * Note: This resets on server restart. For production, consider using
 * a persistent store like Redis or a database.
 */

const sessionStore = new Map<string, string>()

export function setBackgroundSessionId(sandboxId: string, sessionId: string): void {
  sessionStore.set(sandboxId, sessionId)
}

export function getBackgroundSessionId(sandboxId: string): string | undefined {
  return sessionStore.get(sandboxId)
}

export function deleteBackgroundSessionId(sandboxId: string): void {
  sessionStore.delete(sandboxId)
}
