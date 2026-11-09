"use client"

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react"
import { readJSON, writeJSON } from "@/lib/storage"

// =============================================================================
// SidebarContext - Provides sidebar UI state to avoid prop drilling
// =============================================================================

/**
 * What the main content area is currently showing. Used to be a discriminated
 * union with a "job" variant for the standalone scheduled-job report view
 * (ScheduledJobDetailPanel/JobRunDetail); that view was merged into the
 * normal chat view (a job-linked chat now just shows a header strip on top
 * of the regular ChatPanel — see ChatJobRunHeader), so "chat" is the only
 * variant left. Kept as a single-member union rather than collapsing it
 * entirely so a future distinct view can be added back the same way.
 */
export type ActiveView = { type: "chat" }

/**
 * Three independently toggleable "which chats show" filters, orthogonal to
 * repo selection (repoFilter below). A chat is visible if ANY of the toggles
 * that apply to it are on — see isChatVisibleForFilter in lib/chat-tree.ts.
 */
export interface ChatVisibilityFilters {
  /** Non-archived, non-scheduled-job chats. */
  active: boolean
  /** Chats linked to a ScheduledJobRun (job-triggered chats). */
  scheduled: boolean
  /** Chats where chat.archived === true. */
  archived: boolean
}

export const DEFAULT_CHAT_VISIBILITY_FILTERS: ChatVisibilityFilters = {
  active: true,
  scheduled: false,
  archived: true,
}

export interface SidebarContextValue {
  // Sidebar collapse state
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapse: () => void

  // Sidebar width
  width: number
  setWidth: (width: number) => void

  // Mobile sidebar state
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  closeMobileSidebar: () => void

  // Repository filter (which repo(s) to show — orthogonal to
  // chatVisibilityFilters below, which control active/scheduled/archived).
  repoFilter: string
  setRepoFilter: (filter: string) => void

  // Chat visibility filters (active / scheduled / archived) — independently
  // toggleable, see ChatVisibilityFilters above.
  chatVisibilityFilters: ChatVisibilityFilters
  toggleChatVisibilityFilter: (key: keyof ChatVisibilityFilters) => void

  // Chat tree collapse state
  collapsedChatIds: Set<string>
  toggleChatCollapsed: (id: string) => void
  expandChatAndAncestors: (targetId: string, byId: Map<string, { parentChatId?: string | null }>) => void

  // What the main content area is showing — see ActiveView above.
  activeView: ActiveView
  setActiveView: (view: ActiveView) => void
}

interface SidebarProviderProps {
  children: ReactNode
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// Constants for sidebar - exported for use by components
export const ALL_REPOSITORIES = "__all__"
export const NO_REPOSITORY = "__none__"
export const MIN_WIDTH = 140
export const MAX_WIDTH = 400
export const COLLAPSED_WIDTH = 56
export const COLLAPSE_THRESHOLD = 100

// localStorage keys for the repo-filter dropdown's selections — persisted
// client-side (device-specific, not synced to the server) so refreshing the
// page doesn't silently reset "which chats show" back to the defaults.
const REPO_FILTER_KEY = "sidebar-repo-filter"
const CHAT_VISIBILITY_FILTERS_KEY = "sidebar-chat-visibility-filters"

export function SidebarProvider({ children }: SidebarProviderProps) {
  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState(false)
  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), [])

  // Sidebar width
  const [width, setWidth] = useState(260)

  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

  // Repository filter — persisted so it survives a page refresh. Starts at
  // the default on every render (server and first client render) and is
  // patched from localStorage in the effect below, matching the pattern
  // used elsewhere in the app (e.g. useCreditWarning) to avoid an SSR
  // hydration mismatch from reading localStorage during render.
  const [repoFilter, setRepoFilterState] = useState<string>(ALL_REPOSITORIES)
  useEffect(() => {
    setRepoFilterState(readJSON(REPO_FILTER_KEY, ALL_REPOSITORIES, "repo filter"))
  }, [])
  const setRepoFilter = useCallback((filter: string) => {
    setRepoFilterState(filter)
    writeJSON(REPO_FILTER_KEY, filter, "repo filter")
  }, [])

  // Chat visibility filters (active / scheduled / archived) — also persisted.
  const [chatVisibilityFilters, setChatVisibilityFilters] = useState<ChatVisibilityFilters>(
    DEFAULT_CHAT_VISIBILITY_FILTERS
  )
  useEffect(() => {
    setChatVisibilityFilters(readJSON(CHAT_VISIBILITY_FILTERS_KEY, DEFAULT_CHAT_VISIBILITY_FILTERS, "chat visibility filters"))
  }, [])
  const toggleChatVisibilityFilter = useCallback((key: keyof ChatVisibilityFilters) => {
    setChatVisibilityFilters((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      writeJSON(CHAT_VISIBILITY_FILTERS_KEY, next, "chat visibility filters")
      return next
    })
  }, [])

  // Chat tree collapse state
  const [collapsedChatIds, setCollapsedChatIds] = useState<Set<string>>(new Set())

  const toggleChatCollapsed = useCallback((id: string) => {
    setCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandChatAndAncestors = useCallback((targetId: string, byId: Map<string, { parentChatId?: string | null }>) => {
    setCollapsedChatIds((prev) => {
      let next = prev
      let cur = byId.get(targetId)?.parentChatId
      while (cur) {
        if (next.has(cur)) {
          if (next === prev) next = new Set(prev)
          next.delete(cur)
        }
        cur = byId.get(cur)?.parentChatId
      }
      return next
    })
  }, [])

  // What the main content area is showing — see ActiveView.
  const [activeView, setActiveView] = useState<ActiveView>({ type: "chat" })

  const value: SidebarContextValue = {
    collapsed,
    setCollapsed,
    toggleCollapse,
    width,
    setWidth,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    closeMobileSidebar,
    repoFilter,
    setRepoFilter,
    chatVisibilityFilters,
    toggleChatVisibilityFilter,
    collapsedChatIds,
    toggleChatCollapsed,
    expandChatAndAncestors,
    activeView,
    setActiveView,
  }

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
