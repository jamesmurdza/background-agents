export const TURN_STARTUP_TIMEOUT_REASON = "Agent startup timed out. Please send your prompt again."

export type TurnFailureMarker = {
  state: "error"
  executionStopped: boolean
  backgroundSessionId: string
  assistantMessageId: string
  reason: string
}

/** These outcomes belong to one persisted assistant and one execution. */
export function readFailureMarker(
  value: unknown,
  assistantMessageId: string,
  backgroundSessionId?: string,
): TurnFailureMarker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const marker = value as Record<string, unknown>
  if (marker.state !== "error" || typeof marker.executionStopped !== "boolean" ||
      marker.assistantMessageId !== assistantMessageId ||
      typeof marker.backgroundSessionId !== "string" || !marker.backgroundSessionId ||
      (backgroundSessionId !== undefined && marker.backgroundSessionId !== backgroundSessionId) ||
      typeof marker.reason !== "string") return
  return marker as TurnFailureMarker
}

/** The first failure decision is immutable; only stop confirmation advances.
 * A delayed pre-stop snapshot must not undo a confirmed terminal outcome. */
export function mergeFailureMarkers(
  previous: TurnFailureMarker | undefined,
  incoming: TurnFailureMarker | undefined,
): TurnFailureMarker | undefined {
  if (!previous) return incoming
  if (!incoming || previous.executionStopped ||
      incoming.assistantMessageId !== previous.assistantMessageId ||
      incoming.backgroundSessionId !== previous.backgroundSessionId || !incoming.executionStopped) return previous
  return { ...previous, executionStopped: true }
}
