"use client"

import { useRef, useCallback, useEffect } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { Plus, Trash2, Settings, LogOut, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const COLLAPSED_WIDTH = 64

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onOpenSettings: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onWidthChange: (width: number) => void
}

export function Sidebar({
  chats,
  currentChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
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
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
    onWidthChange(newWidth)
  }, [onWidthChange])

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
      <div className="flex items-center justify-between p-3">
        {!collapsed && (
          <h1 className="text-sm font-semibold text-foreground">
            Background Agents
          </h1>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="px-2 pb-2">
        <button
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 w-full rounded-md hover:bg-accent/50 transition-colors cursor-pointer",
            collapsed ? "justify-center p-2" : "px-2 py-2"
          )}
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">New Chat</span>}
        </button>
      </div>

      {/* Chat List */}
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
                onSelect={() => onSelectChat(chat.id)}
                onDelete={() => onDeleteChat(chat.id)}
              />
            ))}
        </div>

        {chats.filter((chat) => chat.messages.length > 0).length === 0 && !collapsed && (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            No chats yet. Click "New Chat" to start.
          </div>
        )}
      </div>

      {/* Footer - User & Settings */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        {session?.user ? (
          <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
            {/* User Avatar & Name */}
            <div
              className={cn(
                "flex items-center gap-2 flex-1 min-w-0",
                collapsed && "flex-col"
              )}
            >
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt={session.user.name || "User"}
                  className="h-8 w-8 rounded-full"
                />
              )}
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {session.user.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {session.user.email}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className={cn("flex gap-1", collapsed && "flex-col mt-2")}>
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
// Chat Item Component
// =============================================================================

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  collapsed: boolean
  onSelect: () => void
  onDelete: () => void
}

function ChatItem({ chat, isActive, collapsed, onSelect, onDelete }: ChatItemProps) {
  const displayName = chat.displayName || chat.branch || getFirstMessagePreview(chat)
  const repoName = chat.repo.split("/")[1]

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md cursor-pointer transition-colors",
        collapsed ? "justify-center p-2" : "px-2 py-1.5",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"
      )}
      onClick={onSelect}
    >
      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate">
              {repoName}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
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

