/**
 * Conversation-history formatting for prompt injection.
 */

import type { HistoryMessage } from "./types"

/**
 * Format conversation history into a preamble for prompt injection.
 *
 * Produces a structured block that precedes the user's actual prompt, giving
 * the agent context from a previous session.
 */
export function formatHistory(history: readonly HistoryMessage[]): string {
  const lines = history.map(
    (m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`
  )
  return (
    "## Conversation History\n" +
    "The following is the conversation history from a previous session. " +
    "Use it as context for the current request.\n\n" +
    lines.join("\n\n")
  )
}
