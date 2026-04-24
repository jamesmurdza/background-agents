"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { Plus, Trash2, Settings, LogOut, PanelLeft, MoreHorizontal, Pin, Pencil, Code2, X, ChevronDown, ChevronRight, FolderGit2, Check, Loader2, HelpCircle, GitMerge, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"

// Repository filter options - exported for use in parent components
export const ALL_REPOSITORIES = "__all__"
export const NO_REPOSITORY = "__none__"

const MIN_WIDTH = 140
const MAX_WIDTH = 400
const COLLAPSED_WIDTH = 64
const COLLAPSE_THRESHOLD = 100 // Collapse when dragged below this width
const SWIPE_THRESHOLD = 80 // Minimum swipe distance to close drawer
interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onRenameChat: (chatId: string, newName: string) => void
  onOpenSettings: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onWidthChange: (width: number) => void
  currentPage?: "chat" | "sdk"
  onNavigate?: (page: "chat" | "sdk") => void
  onOpenHelp?: () => void
  // Mobile drawer props
  isMobile?: boolean
  mobileOpen?: boolean
  onMobileClose?: () => void
  // Repository filter (controlled from parent)
  repoFilter?: string
  onRepoFilterChange?: (filter: string) => void
  // Collapsed chat-tree state (controlled from parent so keyboard navigation
  // can expand branches programmatically).
  collapsedChatIds?: Set<string>
  onToggleChatCollapsed?: (id: string) => void
  /** Drag a chat onto another (same repo) to kick off a merge, or pick Merge
   *  from a chat's context menu (target left unspecified). */
  onRequestMergeChats?: (sourceId: string, targetId?: string) => void
  /** Pick Rebase from a chat's context menu. */
  onRequestRebaseChat?: (sourceId: string) => void
}

export function Sidebar({
  chats,
  currentChatId,
  deletingChatIds,
  unseenChatIds,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  currentPage = "chat",
  onNavigate,
  onOpenHelp,
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
  repoFilter: controlledRepoFilter,
  onRepoFilterChange,
  collapsedChatIds: controlledCollapsedChatIds,
  onToggleChatCollapsed: controlledToggleChatCollapsed,
  onRequestMergeChats,
  onRequestRebaseChat,
}: SidebarProps) {
  const { data: session } = useSession()
  const isResizing = useRef(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Swipe gesture state for mobile drawer
  const [isDragging, setIsDragging] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [startX, setStartX] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Repository filter state - supports controlled mode from parent
  const [internalRepoFilter, setInternalRepoFilter] = useState<string>(ALL_REPOSITORIES)
  const repoFilter = controlledRepoFilter ?? internalRepoFilter
  const setRepoFilter = onRepoFilterChange ?? setInternalRepoFilter
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  // Get unique repositories from chats
  const uniqueRepos = useMemo(() => {
    const repos = new Set<string>()
    chats.forEach((chat) => {
      const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
      if (hasMessages) {
        repos.add(chat.repo)
      }
    })
    return Array.from(repos).sort((a, b) => {
      // Sort NEW_REPOSITORY to the end
      if (a === NEW_REPOSITORY) return 1
      if (b === NEW_REPOSITORY) return -1
      return a.localeCompare(b)
    })
  }, [chats])

  // Filter chats by selected repository, sorted newest-first by last activity
  const filteredChats = useMemo(() => {
    return chats
      .filter((chat) => {
        // Use messageCount if messages haven't been loaded yet, otherwise use messages.length
        const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
        // Show empty chats only if they have a parentChatId (were branched)
        if (!hasMessages && !chat.parentChatId) return false
        if (repoFilter === ALL_REPOSITORIES) return true
        if (repoFilter === NO_REPOSITORY) return chat.repo === NEW_REPOSITORY
        return chat.repo === repoFilter
      })
      .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))
  }, [chats, repoFilter])

  // Build parent → children lookup from the filtered list, preserving sort
  // order. Root chats are the ones with no visible parent.
  const visibleIds = useMemo(() => new Set(filteredChats.map((c) => c.id)), [filteredChats])
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Chat[]>()
    for (const chat of filteredChats) {
      const parentId = chat.parentChatId && visibleIds.has(chat.parentChatId) ? chat.parentChatId : null
      if (parentId) {
        const list = m.get(parentId) ?? []
        list.push(chat)
        m.set(parentId, list)
      }
    }
    return m
  }, [filteredChats, visibleIds])
  const rootChats = useMemo(
    () => filteredChats.filter((c) => !(c.parentChatId && visibleIds.has(c.parentChatId))),
    [filteredChats, visibleIds],
  )

  // Drag-to-merge state: which chat is being dragged, and which chat the
  // pointer is currently over (valid target only).
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const chatById = useMemo(() => {
    const m = new Map<string, Chat>()
    for (const c of chats) m.set(c.id, c)
    return m
  }, [chats])
  const canDrop = useCallback((sourceId: string | null, targetId: string): boolean => {
    if (!sourceId || sourceId === targetId) return false
    const source = chatById.get(sourceId)
    const target = chatById.get(targetId)
    if (!source || !target) return false
    if (!source.branch || !target.branch) return false
    if (source.repo === NEW_REPOSITORY || source.repo !== target.repo) return false
    return true
  }, [chatById])

  // Track which parent chats are collapsed. Default: expanded. Can be
  // overridden by the parent to keep state in sync with keyboard navigation.
  const [internalCollapsedChatIds, setInternalCollapsedChatIds] = useState<Set<string>>(new Set())
  const collapsedChatIds = controlledCollapsedChatIds ?? internalCollapsedChatIds
  const defaultToggleChatCollapsed = useCallback((id: string) => {
    setInternalCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const toggleChatCollapsed = controlledToggleChatCollapsed ?? defaultToggleChatCollapsed

  // Count chats per repository (for dropdown display)
  const repoCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    let total = 0
    let noRepoCount = 0
    chats.forEach((chat) => {
      const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
      if (hasMessages) {
        total++
        if (chat.repo === NEW_REPOSITORY) {
          noRepoCount++
        } else {
          counts[chat.repo] = (counts[chat.repo] || 0) + 1
        }
      }
    })
    return { counts, total, noRepoCount }
  }, [chats])

  // Get display name for repository
  const getRepoDisplayName = (repo: string) => {
    if (repo === NEW_REPOSITORY) return "No repository"
    if (repo === ALL_REPOSITORIES) return "All chats"
    if (repo === NO_REPOSITORY) return "No repository"
    return repo
  }

  // Close repo dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false)
      }
    }
    if (repoDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [repoDropdownOpen])

  // Animate collapse/expand when toggled via button
  const handleToggleCollapse = useCallback(() => {
    setIsAnimating(true)
    onToggleCollapse()
    // Remove transition after animation completes
    const timer = setTimeout(() => setIsAnimating(false), 200)
    return () => clearTimeout(timer)
  }, [onToggleCollapse])

  // Handle drag resize (desktop only)
  const startResizing = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [isMobile])

  const stopResizing = useCallback(() => {
    isResizing.current = false
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing.current || isMobile) return
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
  }, [onWidthChange, collapsed, onToggleCollapse, isMobile])

  useEffect(() => {
    if (isMobile) return
    window.addEventListener("mousemove", resize)
    window.addEventListener("mouseup", stopResizing)
    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
    }
  }, [resize, stopResizing, isMobile])

  // Mobile swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile || !mobileOpen) return
    setIsDragging(true)
    setStartX(e.touches[0].clientX)
    setStartTime(Date.now())
    setDragX(0)
  }, [isMobile, mobileOpen])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return

    const currentX = e.touches[0].clientX
    const diff = currentX - startX

    // Only allow dragging left (negative direction to close)
    if (diff < 0) {
      setDragX(diff)
    }
  }, [isDragging, startX])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return

    setIsDragging(false)

    const duration = Date.now() - startTime
    const velocity = Math.abs(dragX) / duration

    // Close if:
    // 1. Dragged more than threshold
    // 2. OR fast swipe (velocity > 0.5)
    if (Math.abs(dragX) > SWIPE_THRESHOLD || velocity > 0.5) {
      onMobileClose?.()
    }

    setDragX(0)
  }, [isDragging, dragX, startTime, onMobileClose])

  // Close mobile drawer when selecting a chat
  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId)
    if (isMobile && onMobileClose) {
      onMobileClose()
    }
  }

  // Close mobile drawer when creating new chat
  const handleNewChat = () => {
    onNewChat()
    if (isMobile && onMobileClose) {
      onMobileClose()
    }
  }

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isMobile && mobileOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isMobile, mobileOpen])

  // Mobile drawer rendering
  if (isMobile) {
    return (
      <>
        {/* Backdrop overlay */}
        <div
          className={cn(
            "fixed inset-0 z-40 mobile-overlay transition-opacity duration-300",
            mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          onClick={onMobileClose}
          aria-hidden="true"
        />

        {/* Mobile drawer with swipe gesture */}
        <div
          ref={sidebarRef}
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col bg-background border-r border-sidebar-border",
            !isDragging && "transition-transform duration-300 ease-out"
          )}
          style={{
            transform: mobileOpen
              ? `translateX(${Math.min(0, dragX)}px)`
              : "translateX(-100%)",
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Swipe indicator bar */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-16 flex items-center justify-center">
            <div className="w-1 h-8 rounded-full bg-muted-foreground/20" />
          </div>

          {/* Header with close button */}
          <div className="flex items-center justify-between p-4 pt-safe border-b border-sidebar-border">
            <h1 className="text-base font-semibold text-foreground">
              Background Agents
            </h1>
            <button
              onClick={onMobileClose}
              className="p-2 -mr-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors touch-target"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* New Chat Button - larger touch target */}
          <div className="px-3 py-2">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors touch-target hover:bg-accent/50 active:bg-accent"
            >
              <Plus className="h-5 w-5 text-muted-foreground" />
              <span className="text-base text-foreground">New Chat</span>
            </button>
          </div>

          {/* Repository Filter */}
          <div className="px-3 pb-2 relative" ref={repoDropdownRef}>
            <button
              onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
              className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent/50 active:bg-accent transition-colors"
            >
              <span className="truncate">{getRepoDisplayName(repoFilter)}</span>
              <ChevronDown className={cn("h-4 w-4 flex-shrink-0 transition-transform", repoDropdownOpen && "rotate-180")} />
            </button>

            {repoDropdownOpen && (
              <div className="absolute left-3 right-3 top-full mt-1 rounded-lg border border-border bg-popover shadow-lg py-1 z-50 max-h-64 overflow-y-auto">
                {/* All repositories option */}
                <button
                  onClick={() => {
                    setRepoFilter(ALL_REPOSITORIES)
                    setRepoDropdownOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <Check className={cn("h-4 w-4 flex-shrink-0", repoFilter === ALL_REPOSITORIES ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">All chats</span>
                  <span className="text-muted-foreground">{repoCounts.total}</span>
                </button>

                {/* No repository option */}
                {uniqueRepos.includes(NEW_REPOSITORY) && (
                  <button
                    onClick={() => {
                      setRepoFilter(NO_REPOSITORY)
                      setRepoDropdownOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
                  >
                    <Check className={cn("h-4 w-4 flex-shrink-0", repoFilter === NO_REPOSITORY ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">No repository</span>
                    <span className="text-muted-foreground">{repoCounts.noRepoCount}</span>
                  </button>
                )}

                {/* Divider if there are actual repos */}
                {uniqueRepos.some(r => r !== NEW_REPOSITORY) && (
                  <div className="my-1 border-t border-border" />
                )}

                {/* Repository list */}
                {uniqueRepos
                  .filter(repo => repo !== NEW_REPOSITORY)
                  .map((repo) => (
                    <button
                      key={repo}
                      onClick={() => {
                        setRepoFilter(repo)
                        setRepoDropdownOpen(false)
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
                    >
                      <Check className={cn("h-4 w-4 flex-shrink-0", repoFilter === repo ? "opacity-100" : "opacity-0")} />
                      <FolderGit2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{repo}</span>
                      <span className="text-muted-foreground">{repoCounts.counts[repo] || 0}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto mobile-scroll scrollbar-auto-hide px-3 py-2">
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <MobileChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === currentChatId}
                  isDeleting={deletingChatIds.has(chat.id)}
                  isUnseen={unseenChatIds?.has(chat.id) ?? false}
                  onSelect={() => handleSelectChat(chat.id)}
                  onDelete={() => onDeleteChat(chat.id)}
                  onRename={(newName) => onRenameChat(chat.id, newName)}
                />
              ))}
            </div>
          </div>

          {/* Footer - User & Settings */}
          <div className="p-4 pb-safe border-t border-sidebar-border">
            {session?.user ? (
              <div className="flex items-center gap-3">
                {/* User Avatar & Name */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {session.user.image && (
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium truncate">
                      {session.user.name}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {session.user.email}
                    </div>
                  </div>
                </div>

                {/* Action Buttons - larger touch targets */}
                <div className="flex gap-1">
                  <button
                    onClick={onOpenSettings}
                    className="p-3 rounded-lg hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground transition-colors touch-target"
                    title="Settings"
                  >
                    <Settings className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => signOut()}
                    className="p-3 rounded-lg hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground transition-colors touch-target"
                    title="Sign out"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => signIn("github")}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 transition-colors px-4 py-3 touch-target"
              >
                <span className="text-base">Sign in with GitHub</span>
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  // Desktop sidebar rendering (original behavior)
  return (
    <div
      ref={sidebarRef}
      className={cn(
        "relative flex h-full flex-col bg-background border-r border-sidebar-border hide-mobile",
        isAnimating && "transition-[width] duration-200 ease-in-out"
      )}
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
          onClick={handleToggleCollapse}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* New Chat Button */}
      <div className={cn("pb-2", collapsed ? "px-0 flex justify-center" : "px-2")}>
        <button
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors hover:bg-accent/50 cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-2"
          )}
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">New Chat</span>}
        </button>
      </div>

      {/* Chat List - only show when expanded */}
      {!collapsed && (
        <>
          {/* Repository Filter */}
          <div className="px-2 pb-2 relative" ref={repoDropdownRef}>
            <button
              onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <span className="truncate">{getRepoDisplayName(repoFilter)}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform", repoDropdownOpen && "rotate-180")} />
            </button>

            {repoDropdownOpen && (
              <div className="absolute left-2 right-2 top-full mt-1 rounded-md border border-border bg-popover shadow-lg py-1 z-50 max-h-64 overflow-y-auto">
                {/* All repositories option */}
                <button
                  onClick={() => {
                    setRepoFilter(ALL_REPOSITORIES)
                    setRepoDropdownOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                >
                  <Check className={cn("h-3.5 w-3.5 flex-shrink-0", repoFilter === ALL_REPOSITORIES ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">All chats</span>
                  <span className="text-muted-foreground">{repoCounts.total}</span>
                </button>

                {/* No repository option */}
                {uniqueRepos.includes(NEW_REPOSITORY) && (
                  <button
                    onClick={() => {
                      setRepoFilter(NO_REPOSITORY)
                      setRepoDropdownOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                  >
                    <Check className={cn("h-3.5 w-3.5 flex-shrink-0", repoFilter === NO_REPOSITORY ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">No repository</span>
                    <span className="text-muted-foreground">{repoCounts.noRepoCount}</span>
                  </button>
                )}

                {/* Divider if there are actual repos */}
                {uniqueRepos.some(r => r !== NEW_REPOSITORY) && (
                  <div className="my-1 border-t border-border" />
                )}

                {/* Repository list */}
                {uniqueRepos
                  .filter(repo => repo !== NEW_REPOSITORY)
                  .map((repo) => (
                    <button
                      key={repo}
                      onClick={() => {
                        setRepoFilter(repo)
                        setRepoDropdownOpen(false)
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                    >
                      <Check className={cn("h-3.5 w-3.5 flex-shrink-0", repoFilter === repo ? "opacity-100" : "opacity-0")} />
                      <FolderGit2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{repo}</span>
                      <span className="text-muted-foreground">{repoCounts.counts[repo] || 0}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto scrollbar-auto-hide p-2 pt-0">
            <div className="space-y-1">
              {renderChatTree({
                roots: rootChats,
                childrenByParent,
                collapsedChatIds,
                currentChatId,
                deletingChatIds,
                unseenChatIds,
                sidebarCollapsed: collapsed,
                onToggleCollapsed: toggleChatCollapsed,
                onSelectChat,
                onDeleteChat,
                onRenameChat,
                onMerge: onRequestMergeChats ? (id) => onRequestMergeChats(id) : undefined,
                onRebase: onRequestRebaseChat ? (id) => onRequestRebaseChat(id) : undefined,
                dragSourceId,
                dragOverId,
                canDrop,
                onDragStartChat: (id) => setDragSourceId(id),
                onDragEndChat: () => { setDragSourceId(null); setDragOverId(null) },
                onDragEnterChat: (id) => setDragOverId(id),
                onDragLeaveChat: (id) => setDragOverId((prev) => (prev === id ? null : prev)),
                onDropChat: (id) => {
                  if (onRequestMergeChats && dragSourceId) {
                    onRequestMergeChats(dragSourceId, id)
                  }
                  setDragSourceId(null)
                  setDragOverId(null)
                },
              })}
            </div>
          </div>
        </>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Footer - User & Settings */}
      <div className={cn("p-1.5", !collapsed && "border-t border-sidebar-border")}>
        {session?.user ? (
          <UserMenu
            user={session.user}
            onOpenSettings={onOpenSettings}
            onOpenApiReference={() => onNavigate?.("sdk")}
            onOpenHelp={onOpenHelp}
            collapsed={collapsed}
          />
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
// Mobile Chat Item Component with Menu
// =============================================================================

interface MobileChatItemProps {
  chat: Chat
  isActive: boolean
  isDeleting: boolean
  isUnseen: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}

function MobileChatItem({ chat, isActive, isDeleting, isUnseen, onSelect, onDelete, onRename }: MobileChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = chat.displayName || "Untitled"

  const startEditing = () => {
    setEditName(displayName)
    setIsEditing(true)
    setMenuOpen(false)
  }

  const saveEdit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== displayName) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setEditName("")
  }

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

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-2 bg-accent">
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit()
            if (e.key === "Escape") cancelEdit()
          }}
          onBlur={saveEdit}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        />
      </div>
    )
  }

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
      onClick={isDeleting ? undefined : onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{displayName}</div>
      </div>
      {chat.status === "running" || chat.status === "creating" || (chat.queuedMessages && chat.queuedMessages.length > 0) ? (
        <Loader2 className="h-2.5 w-2.5 flex-shrink-0 animate-spin text-foreground/90" />
      ) : isUnseen ? (
        <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/80" />
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
                startEditing()
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
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

// =============================================================================
// Collapsed User Menu Component
// =============================================================================

interface UserMenuProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  onOpenSettings: () => void
  onOpenApiReference?: () => void
  onOpenHelp?: () => void
  collapsed: boolean
}

function UserMenu({ user, onOpenSettings, onOpenApiReference, onOpenHelp, collapsed }: UserMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const avatar = user.image ? (
    <img
      src={user.image}
      alt={user.name || "User"}
      className="h-8 w-8 flex-shrink-0 rounded-full"
    />
  ) : (
    <div className="h-8 w-8 flex-shrink-0 rounded-full bg-muted flex items-center justify-center text-xs">
      {user.name?.[0] || "?"}
    </div>
  )

  return (
    <div className={cn("relative", collapsed ? "flex justify-center" : "")} ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 cursor-pointer rounded-md transition-colors",
          collapsed
            ? "p-0"
            : "w-full min-w-0 px-2 py-1.5 hover:bg-accent text-left"
        )}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {avatar}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user.name}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
        )}
      </button>

      {menuOpen && (
        <div
          className={cn(
            "absolute bottom-full mb-2 w-44 rounded-md border border-border bg-popover shadow-md py-1 z-50",
            collapsed ? "left-0" : "left-0 right-0 w-auto"
          )}
          role="menu"
        >
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
          {onOpenApiReference && (
            <button
              onClick={() => {
                onOpenApiReference()
                setMenuOpen(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
            >
              <Code2 className="h-4 w-4" />
              API Reference
            </button>
          )}
          {onOpenHelp && (
            <button
              onClick={() => {
                onOpenHelp()
                setMenuOpen(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
              Help
            </button>
          )}
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
// Chat Item Component (Desktop)
// =============================================================================

// Recursively render a flat list of chats as a tree of ChatItem components.
// Root chats come first; children are appended in their original (sort-preserved)
// order when their parent is expanded.
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

function renderChatTree(args: RenderChatTreeArgs): React.ReactNode[] {
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

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  collapsed: boolean
  isDeleting: boolean
  isUnseen: boolean
  depth?: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpanded?: () => void
  onSelect: () => void
  onDelete: () => void
  onRename: (newName: string) => void
  onMerge?: () => void
  onRebase?: () => void
  // Drag-to-merge props (optional; when omitted, drag is disabled).
  isDragSource?: boolean
  isDropTarget?: boolean
  onDragStartRow?: () => void
  onDragEndRow?: () => void
  onDragEnterRow?: () => void
  onDragOverRow?: (e: React.DragEvent) => void
  onDragLeaveRow?: () => void
  onDropRow?: () => void
}

function ChatItem({ chat, isActive, collapsed, isDeleting, isUnseen, depth = 0, hasChildren = false, isExpanded = true, onToggleExpanded, onSelect, onDelete, onRename, onMerge, onRebase, isDragSource, isDropTarget, onDragStartRow, onDragEndRow, onDragEnterRow, onDragOverRow, onDragLeaveRow, onDropRow }: ChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = chat.displayName || "Untitled"

  const startEditing = () => {
    setEditName(displayName)
    setIsEditing(true)
    setMenuOpen(false)
  }

  const saveEdit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== displayName) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setEditName("")
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

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

  if (isEditing && !collapsed) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-accent">
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit()
            if (e.key === "Escape") cancelEdit()
          }}
          onBlur={saveEdit}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        />
      </div>
    )
  }

  const indentPx = collapsed ? 0 : depth * 32

  const draggable = !!(onDragStartRow && chat.branch && chat.repo !== NEW_REPOSITORY)

  return (
    <div
      draggable={draggable}
      data-testid="chat-item"
      data-chat-id={chat.id}
      className={cn(
        "group flex items-center gap-2 rounded-md transition-colors select-none",
        collapsed ? "justify-center p-2" : "px-2 py-1.5",
        isDeleting
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer",
        !isDeleting && (isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"),
        isDragSource && "opacity-50",
        isDropTarget && "ring-2 ring-primary/60 bg-primary/10"
      )}
      style={indentPx ? { paddingLeft: `calc(0.5rem + ${indentPx}px)` } : undefined}
      onMouseDown={(e) => {
        // Prevent the browser's native select-on-double-click from highlighting the title text.
        if (e.detail >= 2) e.preventDefault()
      }}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.effectAllowed = "move"
        try { e.dataTransfer.setData("text/plain", chat.id) } catch {}
        onDragStartRow?.()
      } : undefined}
      onDragEnd={draggable ? () => onDragEndRow?.() : undefined}
      onDragEnter={onDragEnterRow ? (e) => { e.preventDefault(); onDragEnterRow() } : undefined}
      onDragOver={onDragOverRow ? (e) => {
        // Continuously reassert that this row is the active drop target so
        // cursor movements over nested children don't flicker the highlight.
        onDragOverRow(e)
        onDragEnterRow?.()
      } : undefined}
      onDragLeave={onDragLeaveRow ? (e) => {
        // Ignore leaves into descendant elements — dragleave fires on the
        // parent whenever the cursor moves to a child node.
        const related = e.relatedTarget as Node | null
        if (related && e.currentTarget.contains(related)) return
        onDragLeaveRow()
      } : undefined}
      onDrop={onDropRow ? (e) => { e.preventDefault(); onDropRow() } : undefined}
      onClick={isDeleting ? undefined : onSelect}
      onDoubleClick={hasChildren && !isDeleting ? (e) => { e.stopPropagation(); onToggleExpanded?.() } : undefined}
    >
      {!collapsed && (
        <>
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpanded?.()
              }}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center -ml-[1px] -mr-[5px] text-foreground/80 hover:text-primary hover:underline rounded-sm cursor-pointer"
              aria-label={isExpanded ? "Collapse children" : "Expand children"}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{displayName}</div>
          </div>

          <div className="relative" ref={menuRef}>
            {chat.status === "running" || chat.status === "creating" || (chat.queuedMessages && chat.queuedMessages.length > 0) ? (
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
                <Loader2 className="h-2.5 w-2.5 animate-spin text-foreground/90" />
              </div>
            ) : isUnseen ? (
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80" />
              </div>
            ) : null}
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
                    startEditing()
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename
                </button>
                {onMerge && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onMerge()
                      setMenuOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    Merge
                  </button>
                )}
                {onRebase && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRebase()
                      setMenuOpen(false)
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    Rebase
                  </button>
                )}
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
