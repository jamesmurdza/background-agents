"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSession, signIn, signOut } from "next-auth/react"
import { Plus, PanelLeft, X, FolderGit2, Loader2, Clock, Search, ChevronDown, Check, BarChart3, Settings, HelpCircle, LogOut } from "lucide-react"
import { usePalette } from "@/components/search-palette/PaletteProvider"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useModals, ALL_REPOSITORIES, NO_REPOSITORY, MIN_WIDTH, MAX_WIDTH, COLLAPSED_WIDTH, COLLAPSE_THRESHOLD } from "@/lib/contexts"
import { clearAllStorage } from "@/lib/storage"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  UserMenu,
  ChatItem,
  MobileChatItem,
  MergedChatCheckmark,
  hasMergedSuccessfully,
  getFirstMessagePreview,
} from "./sidebar"

// Re-export from context for backward compatibility
export { ALL_REPOSITORIES, NO_REPOSITORY } from "@/lib/contexts"

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onRenameChat: (chatId: string, newName: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onWidthChange: (width: number) => void
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
  /** Open scheduled jobs view */
  onOpenScheduledJobs?: () => void
  /** Whether scheduled jobs view is active */
  scheduledJobsActive?: boolean
  /** Currently selected scheduled job (shown as indented item) */
  selectedScheduledJob?: { id: string; name: string } | null
  /** Whether chats are still being loaded from storage/server */
  isLoadingChats?: boolean
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
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
  repoFilter: controlledRepoFilter,
  onRepoFilterChange,
  collapsedChatIds: controlledCollapsedChatIds,
  onToggleChatCollapsed: controlledToggleChatCollapsed,
  onRequestMergeChats,
  onRequestRebaseChat,
  onOpenScheduledJobs,
  scheduledJobsActive = false,
  selectedScheduledJob,
  isLoadingChats = false,
}: SidebarProps) {
  const modals = useModals()
  const { data: session, status: sessionStatus } = useSession()
  const isSessionLoading = sessionStatus === "loading"
  const router = useRouter()
  const { openSearch } = usePalette()
  const isResizing = useRef(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Mobile user menu state
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false)
  const mobileUserMenuRef = useRef<HTMLDivElement>(null)

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
  useClickOutside(repoDropdownRef, () => setRepoDropdownOpen(false), repoDropdownOpen)

  // Close mobile user menu when clicking outside
  useClickOutside(mobileUserMenuRef, () => setMobileUserMenuOpen(false), mobileUserMenuOpen)

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

        {/* Mobile drawer */}
        <div
          ref={sidebarRef}
          className="fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col bg-background border-r border-sidebar-border transition-transform duration-300 ease-out"
          style={{
            transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
          }}
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between px-4 pb-1 pt-safe">
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

          {/* Action Buttons - grouped together */}
          <div className="px-3 py-2 space-y-1">
            {/* New Chat Button - larger touch target */}
            <button
              onClick={handleNewChat}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors touch-target hover:bg-accent/50 active:bg-accent"
            >
              <Plus className="h-5 w-5 text-muted-foreground" />
              <span className="text-base text-foreground">New Chat</span>
            </button>

            {/* Search Chats Button */}
            <button
              onClick={() => {
                openSearch()
                if (onMobileClose) onMobileClose()
              }}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors touch-target hover:bg-accent/50 active:bg-accent"
            >
              <Search className="h-5 w-5 text-muted-foreground" />
              <span className="text-base text-foreground">Search Chats</span>
            </button>

            {/* Scheduled Jobs Button */}
            <button
              onClick={() => {
                if (onOpenScheduledJobs) {
                  onOpenScheduledJobs()
                } else {
                  router.push("/scheduled-jobs")
                }
              }}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors touch-target",
                scheduledJobsActive && !selectedScheduledJob
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50 active:bg-accent"
              )}
            >
              <Clock className={cn("h-5 w-5", scheduledJobsActive && !selectedScheduledJob ? "text-foreground" : "text-muted-foreground")} />
              <span className="text-base text-foreground">Scheduled Agents</span>
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
            <div className="space-y-0.5">
              {isLoadingChats ? (
                /* Chat list skeleton while loading */
                <div className="space-y-0.5 animate-pulse">
                  {[75, 55, 85, 60, 70].map((width, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md">
                      <div className="h-4 flex-1 rounded bg-muted" style={{ width: `${width}%` }} />
                    </div>
                  ))}
                </div>
              ) : (
                filteredChats.map((chat) => (
                  <MobileChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === currentChatId}
                    isDeleting={deletingChatIds.has(chat.id)}
                    isUnseen={unseenChatIds?.has(chat.id) ?? false}
                    onSelect={() => handleSelectChat(chat.id)}
                    onDelete={() => onDeleteChat(chat.id)}
                    onRequestRename={() => modals.setMobileRenameChat({ id: chat.id, name: chat.displayName || "Untitled" })}
                  />
                ))
              )}
            </div>
          </div>

          {/* Footer - User & Settings */}
          <div className="p-4 pb-safe border-t border-sidebar-border">
            {isSessionLoading ? (
              /* User skeleton while session is loading */
              <div className="flex items-center gap-3 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
              </div>
            ) : session?.user ? (
              <div className="relative" ref={mobileUserMenuRef}>
                <button
                  onClick={() => setMobileUserMenuOpen((v) => !v)}
                  className="flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -m-2"
                >
                  {session.user.image && (
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-base font-medium truncate">
                      {session.user.name}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {session.user.email}
                    </div>
                  </div>
                </button>

                {/* User Menu Popup */}
                {mobileUserMenuOpen && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-border bg-popover shadow-md py-1 z-50">
                    {session.user.isAdmin && (
                      <a
                        href="/admin"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileUserMenuOpen(false)}
                        className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
                      >
                        <BarChart3 className="h-5 w-5" />
                        Admin Dashboard
                      </a>
                    )}
                    <button
                      onClick={() => {
                        modals.openSettings()
                        setMobileUserMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
                    >
                      <Settings className="h-5 w-5" />
                      Settings
                    </button>
                    <button
                      onClick={() => {
                        modals.setHelpOpen(true)
                        setMobileUserMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
                    >
                      <HelpCircle className="h-5 w-5" />
                      Help
                    </button>
                    <button
                      onClick={() => {
                        clearAllStorage()
                        signOut()
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-base hover:bg-accent active:bg-accent cursor-pointer"
                    >
                      <LogOut className="h-5 w-5" />
                      Sign out
                    </button>
                  </div>
                )}
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
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Action Buttons - grouped together */}
      <div className={cn(collapsed ? "px-0 flex flex-col items-center gap-1.5" : "px-2")}>
        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors hover:bg-accent/50 cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-[7px]"
          )}
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">New Chat</span>}
        </button>

        {/* Search Chats Button */}
        <button
          onClick={openSearch}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors hover:bg-accent/50 cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-[7px]"
          )}
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">Search Chats</span>}
        </button>

        {/* Scheduled Jobs Button */}
        <button
          onClick={() => {
            if (onOpenScheduledJobs) {
              onOpenScheduledJobs()
            } else {
              router.push("/scheduled-jobs")
            }
          }}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-[7px]",
            scheduledJobsActive && !selectedScheduledJob
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
        >
          <Clock className={cn("h-4 w-4", scheduledJobsActive && !selectedScheduledJob ? "text-foreground" : "text-muted-foreground")} />
          {!collapsed && <span className="text-sm text-foreground">Scheduled Agents</span>}
        </button>
      </div>

      <div className="pb-2" />

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
            <div className="space-y-0">
              {isLoadingChats ? (
                /* Chat list skeleton while loading */
                <div className="space-y-0.5 animate-pulse">
                  {[70, 50, 85, 55, 75, 60].map((width, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-[5px] rounded-md">
                      <div className="h-3.5 flex-1 rounded bg-muted" style={{ width: `${width}%` }} />
                    </div>
                  ))}
                </div>
              ) : (
                renderChatTree({
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
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Footer - User & Settings */}
      <div className={cn("p-1.5", !collapsed && "border-t border-sidebar-border")}>
        {isSessionLoading ? (
          /* User skeleton while session is loading */
          <div className={cn("flex items-center gap-2 animate-pulse", collapsed ? "justify-center" : "px-2 py-1.5")}>
            <div className="h-8 w-8 rounded-full bg-muted flex-shrink-0" />
            {!collapsed && (
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3.5 w-20 rounded bg-muted" />
                <div className="h-2.5 w-28 rounded bg-muted" />
              </div>
            )}
          </div>
        ) : session?.user ? (
          <UserMenu
            user={session.user}
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
// Chat Tree Rendering
// =============================================================================

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
