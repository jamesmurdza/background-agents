"use client"

import type React from "react"
import type { Chat } from "@/lib/types"
import { ChatItem } from "./ChatItem"

interface RenderChatTreeArgs {
  roots: Chat[]
  childrenByParent: Map<string, Chat[]>
  collapsedChatIds: Set<string>
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  sidebarCollapsed: boolean
  onToggleCollapsed: (id: string) => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  /** When provided, rows render an "Archive" action (used by the active section). */
  onArchive?: (id: string) => void
  /** When provided, rows render an "Unarchive" action (used by the archived section). */
  onUnarchive?: (id: string) => void
  onRenameChat: (id: string, newName: string) => void
  onMerge?: (id: string) => void
  onRebase?: (id: string) => void
  dragSourceId?: string | null
  dragOverId?: string | null
  canDrop?: (sourceId: string | null, targetId: string) => boolean
  onDragStartChat?: (id: string) => void
  onDragEndChat?: () => void
  onDragEnterChat?: (id: string) => void
  onDragLeaveChat?: (id: string) => void
  onDropChat?: (id: string) => void
}

/**
 * Flatten the chat tree (roots + childrenByParent) into a list of ChatItem
 * nodes. Walks each root depth-first, skipping subtrees whose parent is
 * collapsed. Hands ChatItem the drag/merge bookkeeping so a row can highlight
 * itself as a valid drop target.
 *
 * Pure — no internal state. The caller already memoizes roots and
 * childrenByParent, so this is just a fold over them.
 */
export function renderChatTree(args: RenderChatTreeArgs): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const walk = (chat: Chat, depth: number) => {
    const children = args.childrenByParent.get(chat.id) ?? []
    const isExpanded = !args.collapsedChatIds.has(chat.id)
    const canAcceptDrop = !!(args.canDrop && args.canDrop(args.dragSourceId ?? null, chat.id))
    out.push(
      <ChatItem
        key={chat.id}
        chat={chat}
        isActive={chat.id === args.currentChatId}
        collapsed={args.sidebarCollapsed}
        isDeleting={args.deletingChatIds.has(chat.id)}
        isUnseen={args.unseenChatIds?.has(chat.id) ?? false}
        depth={depth}
        hasChildren={children.length > 0}
        isExpanded={isExpanded}
        onToggleExpanded={() => args.onToggleCollapsed(chat.id)}
        onSelect={() => args.onSelectChat(chat.id)}
        onDelete={() => args.onDeleteChat(chat.id)}
        onArchive={args.onArchive ? () => args.onArchive!(chat.id) : undefined}
        onUnarchive={args.onUnarchive ? () => args.onUnarchive!(chat.id) : undefined}
        onRename={(newName) => args.onRenameChat(chat.id, newName)}
        onMerge={args.onMerge ? () => args.onMerge!(chat.id) : undefined}
        onRebase={args.onRebase ? () => args.onRebase!(chat.id) : undefined}
        isDragSource={args.dragSourceId === chat.id}
        isDropTarget={canAcceptDrop && args.dragOverId === chat.id}
        onDragStartRow={args.onDragStartChat ? () => args.onDragStartChat!(chat.id) : undefined}
        onDragEndRow={args.onDragEndChat}
        onDragEnterRow={
          canAcceptDrop && args.onDragEnterChat ? () => args.onDragEnterChat!(chat.id) : undefined
        }
        onDragOverRow={
          canAcceptDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" } : undefined
        }
        onDragLeaveRow={args.onDragLeaveChat ? () => args.onDragLeaveChat!(chat.id) : undefined}
        onDropRow={
          canAcceptDrop && args.onDropChat ? () => args.onDropChat!(chat.id) : undefined
        }
      />
    )
    if (isExpanded) {
      for (const c of children) walk(c, depth + 1)
    }
  }
  for (const root of args.roots) walk(root, 0)
  return out
}
