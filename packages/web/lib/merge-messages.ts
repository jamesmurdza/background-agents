import type { Message } from "./types"

/** Preserve streamed content when a concurrent history read has an older copy. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const messages = new Map(existing.map((message) => [message.id, message]))
  const size = (message: Message) => (message.content?.length ?? 0) +
    (message.toolCalls?.length ?? 0) + (message.contentBlocks?.length ?? 0)
  for (const message of incoming) {
    const previous = messages.get(message.id)
    if (!previous || size(message) > size(previous) ||
        (size(message) === size(previous) && message.timestamp > previous.timestamp)) {
      messages.set(message.id, message)
    }
  }
  return Array.from(messages.values()).sort((a, b) => a.timestamp - b.timestamp)
}
