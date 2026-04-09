"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { Plus, Trash2, Settings, LogOut, PanelLeft, MoreHorizontal, Pin, Pencil, Code2 } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"

const MIN_WIDTH = 140
const MAX_WIDTH = 400
const COLLAPSED_WIDTH = 64
const COLLAPSE_THRESHOLD = 100 // Collapse when dragged below this width

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  canCreateChat: boolean
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onOpenSettings: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onWidthChange: (width: number) => void
  currentPage?: "chat" | "sdk"
}

export function Sidebar({
  chats,
  currentChatId,
  deletingChatIds,
  canCreateChat,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  currentPage = "chat",
}: SidebarProps) {
  const { data: session } = useSession()
  const isResizing = useRef(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Handle drag resize
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  const stopResizing = useCallback(() => {
    isResizing.current = false
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return
    // If dragged below threshold, collapse the sidebar
    if (e.clientX < COLLAPSE_THRESHOLD) {
      if (!collapsed) {
        onToggleCollapse()
      }
      return
    }
    // If collapsed and dragged beyond threshold, expand
    if (collapsed && e.clientX >= COLLAPSE_THRESHOLD) {
      onToggleCollapse()
      onWidthChange(MIN_WIDTH)
      return
    }
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
    onWidthChange(newWidth)
  }, [onWidthChange, collapsed, onToggleCollapse])

  useEffect(() => {
    window.addEventListener("mousemove", resize)
    window.addEventListener("mouseup", stopResizing)
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [resize, stopResizing])

  return (
    <div
      ref={sidebarRef}
      className="relative flex h-full flex-col bg-background border-r border-sidebar-border"
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center p-3",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <h1 className="text-sm font-semibold text-foreground truncate">
            Background Agents
          </h1>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* New Chat Button */}
      <div className={cn("pb-1", collapsed ? "px-0 flex justify-center" : "px-2")}>
        <button
          onClick={onNewChat}
          disabled={!canCreateChat}
          title={!canCreateChat ? "Sign in with GitHub to create more chats" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors",
            collapsed ? "p-1.5" : "w-full px-2 py-2",
            canCreateChat
              ? "hover:bg-accent/50 cursor-pointer"
              : "opacity-50 cursor-not-allowed"
          )}
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">New Chat</span>}
        </button>
      </div>

      {/* API Reference Link */}
      <div className={cn("pb-2", collapsed ? "px-0 flex justify-center" : "px-2")}>
        <Link
          href="/sdk"
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors",
            collapsed ? "p-1.5" : "w-full px-2 py-2",
            currentPage === "sdk"
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
        >
          <Code2 className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">API Reference</span>}
        </Link>
      </div>

      {/* Chat List - only show when expanded */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2">
          <div className="space-y-1">
            {chats
              .filter((chat) => chat.messages.length > 0)
              .map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === currentChatId}
                  collapsed={collapsed}
                  isDeleting={deletingChatIds.has(chat.id)}
                  onSelect={() => onSelectChat(chat.id)}
                  onDelete={() => onDeleteChat(chat.id)}
                />
              ))}
          </div>
        </div>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Footer - User & Settings */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        {session?.user ? (
          collapsed ? (
            <CollapsedUserMenu
              user={session.user}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <div className="flex items-center gap-2">
              {/* User Avatar & Name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {session.user.image && (
                  <img
                    src={session.user.image}
                    alt={session.user.name || "User"}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {session.user.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {session.user.email}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-1">
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={() => signOut()}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        ) : (
          <button
            onClick={() => signIn("github")}
            className={cn(
              "flex items-center justify-center gap-2 w-full rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer",
              collapsed ? "p-2" : "px-3 py-2"
            )}
          >
            {!collapsed && <span className="text-sm">Sign in with GitHub</span>}
          </button>
        )}
      </div>

      {/* Resize Handle */}
      {!collapsed && (
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-muted-foreground/30 active:bg-muted-foreground/50 transition-colors"
        />
      )}
    </div>
  )
}

// =============================================================================
// Collapsed User Menu Component
// =============================================================================

interface CollapsedUserMenuProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  onOpenSettings: () => void
}

function CollapsedUserMenu({ user, onOpenSettings }: CollapsedUserMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  return (
    <div className="relative flex justify-center" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="cursor-pointer"
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || "User"}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs">
            {user.name?.[0] || "?"}
          </div>
        )}
      </button>

      {menuOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-40 rounded-md border border-border bg-popover shadow-md py-1 z-50">
          <button
            onClick={() => {
              onOpenSettings()
              setMenuOpen(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Chat Item Component
// =============================================================================

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  collapsed: boolean
  isDeleting: boolean
  onSelect: () => void
  onDelete: () => void
}

function ChatItem({ chat, isActive, collapsed, isDeleting, onSelect, onDelete }: ChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = chat.displayName || "Untitled"

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md transition-colors",
        collapsed ? "justify-center p-2" : "px-2 py-1.5",
        isDeleting
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer",
        !isDeleting && (isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground")
      )}
      onClick={isDeleting ? undefined : onSelect}
    >
      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{displayName}</div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              disabled={isDeleting}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-32 rounded-md border border-border bg-popover shadow-md py-1 z-50">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // TODO: Implement pin functionality
                    setMenuOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                >
                  <Pin className="h-3.5 w-3.5" />
                  Pin
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // TODO: Implement rename functionality
                    setMenuOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                    setMenuOpen(false)
                  }}
                  disabled={isDeleting}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-destructive cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

function getFirstMessagePreview(chat: Chat): string {
  const firstUserMessage = chat.messages.find((m) => m.role === "user")
  if (firstUserMessage) {
    const preview = firstUserMessage.content.slice(0, 30)
    return preview.length < firstUserMessage.content.length
      ? preview + "..."
      : preview
  }
  return "New chat"
}

