import type { Message } from "./types"
import { mergeFailureMarkers, readFailureMarker } from "./turn-failure-marker"

/** Preserve streamed content when a concurrent history read has an older copy. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const messages = new Map(existing.map((message) => [message.id, message]))
  const size = (message: Message) => (message.content?.length ?? 0) +
    (message.toolCalls?.length ?? 0) + (message.contentBlocks?.length ?? 0)
  for (const message of incoming) {
    const previous = messages.get(message.id)
    if (!previous) {
      messages.set(message.id, message)
      continue
    }
    const selected = size(message) > size(previous) ||
      (size(message) === size(previous) && message.timestamp > previous.timestamp) ? message : previous
    // Finalization updates metadata without changing the message's creation
    // timestamp or output length. Merge its monotonic decision independently
    // while retaining the existing protection against shorter history reads.
    const previousFailure = previous.role === "assistant"
      ? readFailureMarker(previous.metadata?.turnFinalization, previous.id) : undefined
    const incomingFailure = message.role === "assistant"
      ? readFailureMarker(message.metadata?.turnFinalization, message.id) : undefined
    const failure = selected.role === "assistant" ? mergeFailureMarkers(previousFailure, incomingFailure) : undefined
    const launchError = selected.role === "assistant" ? message.metadata?.launchError ?? previous.metadata?.launchError : undefined
    messages.set(message.id, failure || launchError ? {
      ...selected,
      metadata: { ...selected.metadata, ...(failure && { turnFinalization: failure }), ...(launchError && { launchError }) },
    } : selected)
  }
  return Array.from(messages.values()).sort((a, b) => a.timestamp - b.timestamp)
}
