"use client"

import { useState, useRef } from "react"
import { MoreHorizontal, Pencil, Trash2, Loader2, ChevronDown, ChevronRight, Archive, ArchiveRestore } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import type { Chat } from "@/lib/types"
import { hasMergedSuccessfully } from "./utils"
import { MergedChatCheckmark } from "./MergedChatCheckmark"

export interface MobileChatItemProps {
  chat: Chat
  isActive: boolean
  isDeleting: boolean
  isUnseen: boolean
  depth?: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpanded?: () => void
  onSelect: () => void
  onDelete: () => void
  /** When provided, the row shows an "Archive" action (active, non-archived chats). */
  onArchive?: () => void
  /** When provided, the row is treated as archived and shows an "Unarchive" action. */
  onUnarchive?: () => void
  onRequestRename: () => void
}

export function MobileChatItem({ chat, isActive, isDeleting, isUnseen, depth = 0, hasChildren = false, isExpanded = true, onToggleExpanded, onSelect, onDelete, onArchive, onUnarchive, onRequestRename }: MobileChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = chat.displayName || "Untitled"

  // Close menu when clicking outside
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  // Indent branched chats to mirror the desktop tree (see ChatItem).
  const indentPx = depth * 24

  return (
    <div
      data-testid="chat-item"
      data-chat-id={chat.id}
      className={cn(
        "flex items-center gap-2 rounded-md transition-colors px-3 py-2",
        isDeleting
          ? "opacity-50 cursor-not-allowed"
          : "active:bg-accent",
        !isDeleting && (isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground")
      )}
      style={indentPx ? { paddingLeft: `calc(0.75rem + ${indentPx}px)` } : undefined}
      onClick={isDeleting ? undefined : onSelect}
    >
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpanded?.()
          }}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center -ml-1 text-foreground/80 rounded-sm"
          aria-label={isExpanded ? "Collapse branches" : "Expand branches"}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{displayName}</div>
      </div>
      {chat.status === "running" || chat.status === "creating" || (chat.queuedMessages && chat.queuedMessages.length > 0) ? (
        <Loader2 className="h-2.5 w-2.5 flex-shrink-0 animate-spin text-foreground/90" />
      ) : isUnseen ? (
        <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/80" />
      ) : hasMergedSuccessfully(chat.messages) ? (
        <MergedChatCheckmark className="flex-shrink-0" />
      ) : null}

      {/* Menu button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
          }}
          disabled={isDeleting}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed"
          aria-label="Chat options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-32 rounded-md border border-border bg-popover shadow-lg py-1 z-50">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                onRequestRename()
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
            {onArchive && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onArchive()
                  setMenuOpen(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </button>
            )}
            {onUnarchive && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUnarchive()
                  setMenuOpen(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Unarchive
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
                setMenuOpen(false)
              }}
              disabled={isDeleting}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left text-destructive disabled:cursor-not-allowed"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
