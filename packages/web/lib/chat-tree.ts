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
  // Empty chats are only shown when branched (parentChatId) or when they've
  // been materialized with a real sandbox (sandboxId) — e.g. via Terminal,
  // Open-in-VS-Code, or Merge on a draft chat, which creates a permanent DB
  // row before any message is sent. A chat with none of these signals is an
  // abandoned client-only draft and should stay hidden.
  const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
  if (!hasMessages && !chat.parentChatId && !chat.sandboxId) return false
  // The "Archived chats" view shows only archived chats (across all repos);
  // every other filter shows only active (non-archived) chats.
  if (repoFilter === ARCHIVED_CHATS) return !!chat.archived
  if (chat.archived) return false
  if (repoFilter === ALL_REPOSITORIES) return true
  if (repoFilter === NO_REPOSITORY) return chat.repo === NEW_REPOSITORY
  return chat.repo === repoFilter
}

/**
 * Group a chat list into a parent → children lookup plus the root list,
 * preserving the incoming order. A chat is a root when it has no parent
 * within the same list, so each subtree renders self-contained.
 *
 * Shared by the Sidebar (which renders this structure directly) and
 * {@link buildTreeOrderedChatIds} (which flattens it for keyboard
 * navigation) so the parent/child grouping logic lives in exactly one place.
 */
export function groupChatsByParent(list: Chat[]): {
  childrenByParent: Map<string, Chat[]>
  roots: Chat[]
} {
  const ids = new Set(list.map((c) => c.id))
  const childrenByParent = new Map<string, Chat[]>()
  for (const chat of list) {
    const parentId = chat.parentChatId && ids.has(chat.parentChatId) ? chat.parentChatId : null
    if (parentId) {
      const arr = childrenByParent.get(parentId) ?? []
      arr.push(chat)
      childrenByParent.set(parentId, arr)
    }
  }
  const roots = list.filter((c) => !(c.parentChatId && ids.has(c.parentChatId)))
  return { childrenByParent, roots }
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

  const { childrenByParent, roots } = groupChatsByParent(visible)
  const out: string[] = []
  const walk = (c: Chat) => {
    out.push(c.id)
    const children = childrenByParent.get(c.id) ?? []
    for (const child of children) walk(child)
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * Compute which chat should be selected after the sidebar repo filter changes.
 *
 * The rule: if the currently selected chat is still visible under the new
 * filter, keep it. Otherwise land on the first chat in the newly filtered list
 * so the user always sees a chat that belongs to the selected filter. Returns
 * null only when the filter matches no chats at all.
 */
export function getChatIdForRepoFilter(
  chats: Chat[],
  repoFilter: string,
  currentChatId: string | null
): string | null {
  const orderedIds = buildTreeOrderedChatIds(chats, repoFilter)
  if (currentChatId && orderedIds.includes(currentChatId)) return currentChatId
  return orderedIds[0] ?? null
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
