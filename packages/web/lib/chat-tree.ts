// Pure helpers for ordering chats the way the sidebar displays them and for
// picking the next chat to select after a deletion.
//
// Extracted from page.tsx so the (non-trivial) tree-walk logic can be unit
// tested without rendering the whole app.

import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { ALL_REPOSITORIES, NO_REPOSITORY } from "@/lib/contexts"

/**
 * Build the full tree-ordered id list matching the sidebar, ignoring collapsed
 * state — so keyboard navigation (Alt+Up/Down) can reach every chat, expanding
 * collapsed ancestors along the way.
 *
 * Applies the same repo filter and visibility rules as the Sidebar so the
 * navigation order matches the visual order.
 */
export function buildTreeOrderedChatIds(chats: Chat[], repoFilter: string): string[] {
  // Show empty chats only if they have a parentChatId (i.e. were branched).
  const visible = chats.filter((c) => {
    const hasMessages = c.messages.length > 0 || (c.messageCount ?? 0) > 0
    if (!hasMessages && !c.parentChatId) return false
    if (repoFilter === ALL_REPOSITORIES) return true
    if (repoFilter === NO_REPOSITORY) return c.repo === NEW_REPOSITORY
    return c.repo === repoFilter
  })

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
