"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { signInWithGitHub } from "@/lib/auth-utils"
import { SquarePen, PanelLeft, X, Clock, Search, MessageCircle } from "lucide-react"
import Image from "next/image"
import { usePalette } from "@/components/search-palette/PaletteProvider"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useDragResize } from "@/lib/hooks/useDragResize"
import { useElectron } from "@/lib/hooks/useElectron"
import { useGitHubUserQuery } from "@/lib/query"
import { useModals, ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS, MIN_WIDTH, MAX_WIDTH, COLLAPSED_WIDTH, COLLAPSE_THRESHOLD } from "@/lib/contexts"
import { isChatVisibleForFilter, groupChatsByParent } from "@/lib/chat-tree"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  UserMenu,
  RepoFilterDropdown,
  ChatListSkeleton,
  renderChatTree,
  renderMobileChatTree,
  getChatRepos,
  stripOwnerPrefix,
} from "./sidebar/index"

// Re-export from context for backward compatibility
export { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  deletingChatIds: Set<string>
  unseenChatIds?: Set<string>
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  /** Pin or unpin a chat, sorting it to the top of the list. */
  onPinChat?: (chatId: string, pinned: boolean) => void
  /** Branch a new chat from an existing chat (creates a sibling and switches to it). */
  onBranchChat?: (chatId: string) => void
  /** Archive an active chat (and its branches), moving it into the archived section. */
  onArchiveChat?: (chatId: string) => void
  /** Restore an archived chat (and its branches) back to the active list. */
  onUnarchiveChat?: (chatId: string) => void
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
  onPinChat,
  onBranchChat,
  onArchiveChat,
  onUnarchiveChat,
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
  // Current user's GitHub login, used to drop the redundant `login/` prefix
  // from their own repos in the filter menu.
  const { data: currentUserLogin } = useGitHubUserQuery()
  const router = useRouter()
  const { openSearch } = usePalette()
  const { isDesktopApp } = useElectron()
  const [isAnimating, setIsAnimating] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Collapsed sidebar: popup listing chat titles so a chat can be switched to
  // without expanding the sidebar.
  const [chatSwitcherOpen, setChatSwitcherOpen] = useState(false)
  const chatSwitcherRef = useRef<HTMLDivElement>(null)

  // Repository filter state - supports controlled mode from parent
  const [internalRepoFilter, setInternalRepoFilter] = useState<string>(ALL_REPOSITORIES)
  const repoFilter = controlledRepoFilter ?? internalRepoFilter
  const setRepoFilter = onRepoFilterChange ?? setInternalRepoFilter
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  // Get unique repositories from chats (shared with the command palette).
  const uniqueRepos = useMemo(
    () => getChatRepos(chats, currentUserLogin),
    [chats, currentUserLogin]
  )

  // Filter chats by selected repository. Pinned chats sort to the top; within
  // each group, newest-first by last activity. Visibility is delegated to the
  // shared isChatVisibleForFilter predicate so the rendered list can never drift
  // from what keyboard navigation reaches.
  const filteredChats = useMemo(() => {
    return chats
      .filter((chat) => isChatVisibleForFilter(chat, repoFilter))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt)
      })
  }, [chats, repoFilter])

  // Whether the archived view is currently active — archived rows expose
  // Unarchive (instead of Archive) and omit drag-to-merge.
  const showingArchived = repoFilter === ARCHIVED_CHATS

  // Build a parent → children lookup + root list for the filtered chats.
  // Shared with keyboard navigation's tree walk via groupChatsByParent so the
  // grouping logic lives in exactly one place.
  const { childrenByParent, roots: rootChats } = useMemo(
    () => groupChatsByParent(filteredChats),
    [filteredChats]
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
    let archivedCount = 0
    chats.forEach((chat) => {
      const hasMessages = chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
      if (!hasMessages) return
      if (chat.archived) {
        archivedCount++
        return
      }
      total++
      if (chat.repo === NEW_REPOSITORY) {
        noRepoCount++
      } else {
        counts[chat.repo] = (counts[chat.repo] || 0) + 1
      }
    })
    return { counts, total, noRepoCount, archivedCount }
  }, [chats])

  // Get display name for repository. Repos owned by the current user are shown
  // without their `login/` prefix (e.g. "jamesmurdza/foo" → "foo"); repos owned
  // by anyone else keep the full "owner/name" form.
  const getRepoDisplayName = (repo: string) => {
    if (repo === NEW_REPOSITORY) return "No repository"
    if (repo === ALL_REPOSITORIES) return "Active chats"
    if (repo === ARCHIVED_CHATS) return "Archived chats"
    if (repo === NO_REPOSITORY) return "No repository"
    return stripOwnerPrefix(repo, currentUserLogin)
  }

  // Close repo dropdown when clicking outside
  useClickOutside(repoDropdownRef, () => setRepoDropdownOpen(false), repoDropdownOpen)

  // Close the collapsed chat switcher popup when clicking outside
  useClickOutside(chatSwitcherRef, () => setChatSwitcherOpen(false), chatSwitcherOpen)

  // Close the chat switcher popup if the sidebar expands (its trigger unmounts,
  // but reset the flag so it doesn't reopen pre-opened if collapsed again later).
  useEffect(() => {
    if (!collapsed) setChatSwitcherOpen(false)
  }, [collapsed])

  // Animate collapse/expand when toggled via button
  const handleToggleCollapse = useCallback(() => {
    setIsAnimating(true)
    onToggleCollapse()
    // Remove transition after animation completes
    const timer = setTimeout(() => setIsAnimating(false), 200)
    return () => clearTimeout(timer)
  }, [onToggleCollapse])

  // Handle drag resize (desktop only)
  const resize = useCallback((e: MouseEvent) => {
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

  const { startDrag } = useDragResize(resize)
  const startResizing = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    startDrag(e)
  }, [isMobile, startDrag])

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

  // Open the scheduled jobs panel (if the host provides one), falling back
  // to navigating to the standalone page. Shared by the mobile and desktop
  // "Scheduled Agents" buttons.
  const handleOpenScheduledJobsClick = () => {
    if (onOpenScheduledJobs) {
      onOpenScheduledJobs()
    } else {
      router.push("/scheduled-jobs")
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
          <div className="flex items-center justify-between px-4 pt-safe">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-foreground">
                Background Agents
              </h1>
            </div>
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
              <SquarePen className="h-5 w-5 text-muted-foreground" />
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
              onClick={handleOpenScheduledJobsClick}
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
            <RepoFilterDropdown
              repoFilter={repoFilter}
              setRepoFilter={setRepoFilter}
              repoDropdownOpen={repoDropdownOpen}
              setRepoDropdownOpen={setRepoDropdownOpen}
              uniqueRepos={uniqueRepos}
              repoCounts={repoCounts}
              getRepoDisplayName={getRepoDisplayName}
              variant="mobile"
            />
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto mobile-scroll scrollbar-auto-hide px-3 py-2">
            <div className="space-y-0.5">
              {isLoadingChats ? (
                <ChatListSkeleton
                  widths={[75, 55, 85, 60, 70]}
                  containerClassName="space-y-0.5"
                  rowClassName="flex items-center gap-2 px-3 py-2 rounded-md"
                />
              ) : (
                renderMobileChatTree({
                  roots: rootChats,
                  childrenByParent,
                  collapsedChatIds,
                  currentChatId,
                  deletingChatIds,
                  unseenChatIds,
                  onToggleCollapsed: toggleChatCollapsed,
                  onSelectChat: handleSelectChat,
                  onDeleteChat,
                  onPin: showingArchived ? undefined : onPinChat,
                  onBranch: showingArchived ? undefined : onBranchChat,
                  onArchive: showingArchived ? undefined : onArchiveChat,
                  onUnarchive: showingArchived ? onUnarchiveChat : undefined,
                  onRequestRename: (id, name) => modals.setMobileRenameChat({ id, name }),
                })
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
              <UserMenu user={session.user} collapsed={false} variant="mobile" />
            ) : (
              <button
                onClick={() => signInWithGitHub()}
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
      <div
        className={cn(
          "flex items-center p-3",
          collapsed ? "justify-center" : "justify-between",
          // On desktop, when collapsed, push the icons down so they don't sit
          // under the macOS traffic-light / window control buttons.
          isDesktopApp && collapsed && "mt-[30px]"
        )}
        style={isDesktopApp ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}
      >
        {collapsed ? (
          // Collapsed: the logo doubles as the expand control. It shows the
          // mask icon by default and swaps to the panel-toggle icon on hover,
          // instead of showing both side by side (too cramped at this width).
          <button
            onClick={handleToggleCollapse}
            className="group relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
            style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <Image
              src="/mask-icon-light.svg"
              alt="Background Agents"
              width={18}
              height={18}
              className="h-[18px] w-[18px] transition-opacity group-hover:opacity-0 dark:hidden"
              priority
            />
            <Image
              src="/mask-icon-dark.svg"
              alt="Background Agents"
              width={18}
              height={18}
              className="hidden h-[18px] w-[18px] transition-opacity group-hover:opacity-0 dark:block"
              priority
            />
            <PanelLeft className="absolute h-[18px] w-[18px] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <div className={cn(
              "flex items-center gap-2",
              isDesktopApp && "invisible" // Hide text but keep space for window controls
            )}>
              <h1 className="text-sm font-semibold text-foreground truncate">
                Background Agents
              </h1>
            </div>
            <button
              onClick={handleToggleCollapse}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
              aria-label="Collapse sidebar"
            >
              <PanelLeft className="h-[18px] w-[18px]" />
            </button>
          </>
        )}
      </div>

      {/* Action Buttons - grouped together */}
      <div className={cn("flex flex-col", collapsed ? "px-0 items-center gap-2" : "px-2 gap-1")}>
        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors hover:bg-accent/50 cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-[7px]"
          )}
        >
          <SquarePen className="h-[18px] w-[18px] text-muted-foreground" />
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
          <Search className="h-[18px] w-[18px] text-muted-foreground" />
          {!collapsed && <span className="text-sm text-foreground">Search Chats</span>}
        </button>

        {/* Chat Switcher - collapsed only, since the chat list itself is hidden */}
        {collapsed && (
          <div className="relative" ref={chatSwitcherRef}>
            <button
              onClick={() => setChatSwitcherOpen((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-md p-1.5 transition-colors cursor-pointer",
                chatSwitcherOpen ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
              aria-label="Switch chat"
              aria-haspopup="menu"
              aria-expanded={chatSwitcherOpen}
              title="Chats"
            >
              <MessageCircle className="h-[18px] w-[18px] text-muted-foreground" />
            </button>

            {chatSwitcherOpen && (
              <div
                className="absolute left-full top-0 ml-2 w-64 max-h-96 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 z-50"
                role="menu"
              >
                {filteredChats.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No chats</div>
                ) : (
                  filteredChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => {
                        onSelectChat(chat.id)
                        setChatSwitcherOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-sm text-left truncate cursor-pointer",
                        chat.id === currentChatId ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                      )}
                      role="menuitem"
                    >
                      <span className="truncate">{chat.displayName || "Untitled"}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Scheduled Jobs Button */}
        <button
          onClick={handleOpenScheduledJobsClick}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors cursor-pointer",
            collapsed ? "p-1.5" : "w-full px-2 py-[7px]",
            scheduledJobsActive && !selectedScheduledJob
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
        >
          <Clock className={cn("h-[18px] w-[18px]", scheduledJobsActive && !selectedScheduledJob ? "text-foreground" : "text-muted-foreground")} />
          {!collapsed && <span className="text-sm text-foreground">Scheduled Agents</span>}
        </button>
      </div>

      <div className="pb-2" />

      {/* Chat List - only show when expanded */}
      {!collapsed && (
        <>
          {/* Repository Filter */}
          <div className="px-2 pb-2 relative" ref={repoDropdownRef}>
            <RepoFilterDropdown
              repoFilter={repoFilter}
              setRepoFilter={setRepoFilter}
              repoDropdownOpen={repoDropdownOpen}
              setRepoDropdownOpen={setRepoDropdownOpen}
              uniqueRepos={uniqueRepos}
              repoCounts={repoCounts}
              getRepoDisplayName={getRepoDisplayName}
              variant="desktop"
            />
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto scrollbar-auto-hide p-2 pt-0">
            <div className="space-y-0">
              {isLoadingChats ? (
                <ChatListSkeleton
                  widths={[70, 50, 85, 55, 75, 60]}
                  containerClassName="space-y-0"
                  rowClassName="flex items-center gap-2 px-2 py-[5px] rounded-md"
                />
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
                  onPin: showingArchived ? undefined : onPinChat,
                  onBranch: showingArchived ? undefined : onBranchChat,
                  onArchive: showingArchived ? undefined : onArchiveChat,
                  onUnarchive: showingArchived ? onUnarchiveChat : undefined,
                  onRenameChat,
                  // Merge/rebase and drag-to-merge apply to active chats only.
                  onMerge: showingArchived || !onRequestMergeChats ? undefined : (id) => onRequestMergeChats(id),
                  onRebase: showingArchived || !onRequestRebaseChat ? undefined : (id) => onRequestRebaseChat(id),
                  dragSourceId: showingArchived ? null : dragSourceId,
                  dragOverId: showingArchived ? null : dragOverId,
                  canDrop: showingArchived ? undefined : canDrop,
                  onDragStartChat: showingArchived ? undefined : (id) => setDragSourceId(id),
                  onDragEndChat: showingArchived ? undefined : () => { setDragSourceId(null); setDragOverId(null) },
                  onDragEnterChat: showingArchived ? undefined : (id) => setDragOverId(id),
                  onDragLeaveChat: showingArchived ? undefined : (id) => setDragOverId((prev) => (prev === id ? null : prev)),
                  onDropChat: showingArchived ? undefined : (id) => {
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
            onClick={() => signInWithGitHub()}
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

