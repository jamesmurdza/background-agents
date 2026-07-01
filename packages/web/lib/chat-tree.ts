// Pure helpers for ordering chats the way the sidebar displays them and for
// picking the next chat to select after a deletion.
//
// Extracted from page.tsx so the (non-trivial) tree-walk logic can be unit
// tested without rendering the whole app.

import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"

/**
 * THE single source of truth for "is this chat shown under the current sidebar
 * filter?".
 *
 * Both the sidebar's rendered list (Sidebar's `filteredChats`) and the
 * keyboard-navigation order (`buildTreeOrderedChatIds`) MUST derive visibility
 * from this one function. Keeping them in a single predicate is what makes a
 * whole class of bug impossible: a chat you cannot see (e.g. an archived chat
 * while viewing "Active chats") can never become reachable by Alt+Up/Down,
 * because "what's navigable" is defined as "what's visible". Do not re-implement
 * this logic anywhere else — import it.
 */
export function isChatVisibleForFilter(chat: Chat, repoFilter: string): boolean {
  // Empty chats are only shown when branched (they carry a parentChatId).
  const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
  if (!hasMessages && !chat.parentChatId) return false
  // The "Archived chats" view shows only archived chats (across all repos);
  // every other filter shows only active (non-archived) chats.
  if (repoFilter === ARCHIVED_CHATS) return !!chat.archived
  if (chat.archived) return false
  if (repoFilter === ALL_REPOSITORIES) return true
  if (repoFilter === NO_REPOSITORY) return chat.repo === NEW_REPOSITORY
  return chat.repo === repoFilter
}

/**
 * Build the full tree-ordered id list matching the sidebar, ignoring collapsed
 * state — so keyboard navigation (Alt+Up/Down) can reach every chat, expanding
 * collapsed ancestors along the way.
 *
 * Applies the exact same visibility rule as the Sidebar (via
 * {@link isChatVisibleForFilter}) so the navigation order can never include a
 * chat the sidebar is hiding.
 */
export function buildTreeOrderedChatIds(chats: Chat[], repoFilter: string): string[] {
  const visible = chats.filter((c) => isChatVisibleForFilter(c, repoFilter))

  visible.sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))

  const visibleIds = new Set(visible.map((c) => c.id))
  const kids = new Map<string, Chat[]>()
  for (const c of visible) {
    const parent = c.parentChatId && visibleIds.has(c.parentChatId) ? c.parentChatId : null
    if (parent) {
      const list = kids.get(parent) ?? []
      list.push(c)
      kids.set(parent, list)
    }
  }

  const roots = visible.filter((c) => !(c.parentChatId && visibleIds.has(c.parentChatId)))
  const out: string[] = []
  const walk = (c: Chat) => {
    out.push(c.id)
    const children = kids.get(c.id) ?? []
    for (const child of children) walk(child)
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * Compute the chat to select after deleting `deletedIds`: the following chat in
 * tree order, or the previous one if the deleted chat was last. Returns null
 * when nothing remains.
 */
export function getNextChatIdAfterDeletion(
  treeOrderedChatIds: string[],
  deletedIds: string[]
): string | null {
  const deletedSet = new Set(deletedIds)
  const remaining = treeOrderedChatIds.filter((id) => !deletedSet.has(id))
  if (remaining.length === 0) return null

  // Index of the first deleted chat in the original order.
  const firstDeletedIdx = treeOrderedChatIds.findIndex((id) => deletedSet.has(id))

  // Select chat at the same index (the following chat) or the last remaining
  // one if that index is now beyond the bounds.
  const targetIdx = Math.min(firstDeletedIdx, remaining.length - 1)
  return remaining[targetIdx] ?? null
}
