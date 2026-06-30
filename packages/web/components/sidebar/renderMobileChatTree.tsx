"use client"

import type React from "react"
import type { Chat } from "@/lib/types"
import { MobileChatItem } from "./MobileChatItem"

interface RenderMobileChatTreeArgs {
  roots: Chat[]
  childrenByParent: Map<string, Chat[]>
  collapsedChatIds: Set<string>
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onToggleCollapsed: (id: string) => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  /** When provided, rows render an "Unarchive" action (used by the archived section). */
  onUnarchive?: (id: string) => void
  onRequestRename: (id: string, name: string) => void
}

/**
 * Mobile counterpart to renderChatTree: flattens the chat tree (roots +
 * childrenByParent) into a depth-first list of MobileChatItem rows so branched
 * chats are indented and collapsible, matching the desktop sidebar. Subtrees
 * under a collapsed parent are skipped.
 */
export function renderMobileChatTree(args: RenderMobileChatTreeArgs): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const walk = (chat: Chat, depth: number) => {
    const children = args.childrenByParent.get(chat.id) ?? []
    const isExpanded = !args.collapsedChatIds.has(chat.id)
    out.push(
      <MobileChatItem
        key={chat.id}
        chat={chat}
        isActive={chat.id === args.currentChatId}
        isDeleting={args.deletingChatIds.has(chat.id)}
        isUnseen={args.unseenChatIds?.has(chat.id) ?? false}
        depth={depth}
        hasChildren={children.length > 0}
        isExpanded={isExpanded}
        onToggleExpanded={() => args.onToggleCollapsed(chat.id)}
        onSelect={() => args.onSelectChat(chat.id)}
        onDelete={() => args.onDeleteChat(chat.id)}
        onUnarchive={args.onUnarchive ? () => args.onUnarchive!(chat.id) : undefined}
        onRequestRename={() => args.onRequestRename(chat.id, chat.displayName || "Untitled")}
      />
    )
    if (isExpanded) {
      for (const c of children) walk(c, depth + 1)
    }
  }
  for (const root of args.roots) walk(root, 0)
  return out
}
