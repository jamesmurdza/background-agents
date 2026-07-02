import type { Chat, Message } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"

/**
 * Unique repositories that have at least one active (non-archived, non-empty)
 * chat — the exact set shown in the sidebar's repository selector. Repos owned
 * by the current user come first, then everyone else's, then NEW_REPOSITORY (the
 * "No repository" bucket) last; alphabetical within each group.
 *
 * Shared by the sidebar and the command palette so the two never drift.
 */
export function getChatRepos(chats: Chat[], currentUserLogin?: string | null): string[] {
  const repos = new Set<string>()
  for (const chat of chats) {
    const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
    if (hasMessages && !chat.archived) {
      repos.add(chat.repo)
    }
  }
  const ownedByCurrentUser = (repo: string) =>
    !!currentUserLogin && repo.toLowerCase().startsWith(`${currentUserLogin.toLowerCase()}/`)
  return Array.from(repos).sort((a, b) => {
    if (a === NEW_REPOSITORY) return 1
    if (b === NEW_REPOSITORY) return -1
    const aOwned = ownedByCurrentUser(a)
    const bOwned = ownedByCurrentUser(b)
    if (aOwned !== bOwned) return aOwned ? -1 : 1
    return a.localeCompare(b)
  })
}

/**
 * Check if a chat has a successful merge message after the last user message.
 * Used to show a checkmark in the sidebar for merged chats.
 */
export function hasMergedSuccessfully(messages: Message[]): boolean {
  // Find index of the last user message
  let lastUserMessageIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserMessageIndex = i
      break
    }
  }

  // Look for a successful merge message after the last user message
  const startIndex = lastUserMessageIndex + 1
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]
    if (
      msg.messageType === "git-operation" &&
      !msg.isError &&
      /^(Squash )?[Mm]erged .+ into .+\.$/.test(msg.content)
    ) {
      return true
    }
  }

  return false
}
