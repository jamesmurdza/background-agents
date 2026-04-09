/**
 * Simple in-memory session store
 * Maps sandboxId -> backgroundSessionId and accumulated events
 *
 * Note: This resets on server restart. For production, consider using
 * a persistent store like Redis or a database.
 */

import type { Event } from "@upstream/agents"

interface SessionData {
  sessionId: string
  accumulatedEvents: Event[]
}

const sessionStore = new Map<string, SessionData>()

export function setBackgroundSessionId(sandboxId: string, sessionId: string): void {
  sessionStore.set(sandboxId, { sessionId, accumulatedEvents: [] })
}

export function getBackgroundSessionId(sandboxId: string): string | undefined {
  return sessionStore.get(sandboxId)?.sessionId
}

export function deleteBackgroundSessionId(sandboxId: string): void {
  sessionStore.delete(sandboxId)
}

export function getAccumulatedEvents(sandboxId: string): Event[] {
  return sessionStore.get(sandboxId)?.accumulatedEvents ?? []
}

export function addAccumulatedEvents(sandboxId: string, events: Event[]): Event[] {
  const data = sessionStore.get(sandboxId)
  if (!data) return events

  // Add new events to accumulated list
  data.accumulatedEvents = [...data.accumulatedEvents, ...events]
  return data.accumulatedEvents
}
