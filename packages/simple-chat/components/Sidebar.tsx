"use client"

import { useSession, signIn, signOut } from "next-auth/react"
import { Plus, MessageSquare, Trash2, Settings, LogOut, ChevronLeft, ChevronRight } from "lucide-react"
import { cn, formatRelativeTime } from "@/lib/utils"
import type { Chat } from "@/lib/types"

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onOpenSettings: () => void
  collapsed: boolean
  onToggleCollapse: () => void
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
}: SidebarProps) {
  const { data: session } = useSession()

  // Group chats by date
  const groupedChats = groupChatsByDate(chats)

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
        {!collapsed && (
          <h1 className="text-sm font-semibold text-sidebar-foreground">
            Simple Chat
          </h1>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="p-2">
        <button
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 w-full rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            collapsed ? "justify-center p-2" : "px-3 py-2"
          )}
        >
          <Plus className="h-4 w-4" />
          {!collapsed && <span className="text-sm">New Chat</span>}
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(groupedChats).map(([date, dateChats]) => (
          <div key={date} className="mb-4">
            {!collapsed && (
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {date}
              </div>
            )}
            <div className="space-y-1">
              {dateChats.map((chat) => (
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
          </div>
        ))}

        {chats.length === 0 && !collapsed && (
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
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => signOut()}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
              "flex items-center justify-center gap-2 w-full rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors",
              collapsed ? "p-2" : "px-3 py-2"
            )}
          >
            {!collapsed && <span className="text-sm">Sign in with GitHub</span>}
          </button>
        )}
      </div>
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
      <MessageSquare className="h-4 w-4 shrink-0" />

      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate">
              {repoName} • {formatRelativeTime(chat.updatedAt)}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
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

function groupChatsByDate(chats: Chat[]): Record<string, Chat[]> {
  const groups: Record<string, Chat[]> = {}
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  for (const chat of chats) {
    const chatDate = new Date(chat.updatedAt)
    let group: string

    if (chatDate >= today) {
      group = "Today"
    } else if (chatDate >= yesterday) {
      group = "Yesterday"
    } else if (chatDate >= lastWeek) {
      group = "Last 7 days"
    } else {
      group = "Older"
    }

    if (!groups[group]) {
      groups[group] = []
    }
    groups[group].push(chat)
  }

  return groups
}
