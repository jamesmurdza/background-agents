/**
 * UI State Store using Zustand
 *
 * Manages application-wide UI state including:
 * - Modal open/close states
 * - Sidebar states
 * - Loading states
 * - Panel visibility
 */

import { create } from "zustand"
import { devtools } from "zustand/middleware"

// Content Panel tab types
export interface ContentPanelTab {
  id: string                      // "file-{path}", "terminal-{n}", or "server-{port}"
  type: "file" | "terminal" | "server"
  filePath?: string               // For file tabs
  filename?: string               // Display name
  port?: number                   // For server tabs
  url?: string                    // For server tabs
}

interface UIState {
  // Sidebar
  mobileSidebarOpen: boolean

  // Loading states
  mobileSandboxToggleLoading: boolean
  mobilePrLoading: boolean

  // Modals
  settingsOpen: boolean
  settingsHighlightField: string | null
  addRepoOpen: boolean
  repoSettingsOpen: boolean
  mobileDiffOpen: boolean

  // Panels
  gitHistoryOpen: boolean
  gitHistoryRefreshTrigger: number

  // Content Panel (right side)
  contentPanelOpen: boolean
  contentPanelWidth: number
  contentPanelTabs: ContentPanelTab[]
  contentPanelActiveTabId: string | null
  contentPanelTerminalCounter: number

  // Desktop rebase conflict indicator
  desktopRebaseConflict: boolean

  // Repo settings data
  repoEnvVars: Record<string, boolean> | null

  // Pending state
  pendingStartCommit: string | null

  // Pending repo from URL (when user visits /owner/repo that isn't in their list)
  pendingRepoFromUrl: { owner: string; name: string } | null
}

interface UIActions {
  // Sidebar actions
  openMobileSidebar: () => void
  closeMobileSidebar: () => void
  toggleMobileSidebar: () => void
  setMobileSidebarOpen: (open: boolean) => void

  // Derived state helpers
  hasActiveServer: () => boolean

  // Loading actions
  setMobileSandboxToggleLoading: (loading: boolean) => void
  setMobilePrLoading: (loading: boolean) => void

  // Settings modal actions
  openSettings: (highlightField?: string) => void
  closeSettings: () => void
  clearSettingsHighlight: () => void

  // Add repo modal actions
  openAddRepo: () => void
  closeAddRepo: () => void

  // Repo settings modal actions
  openRepoSettings: () => void
  closeRepoSettings: () => void
  setRepoEnvVars: (envVars: Record<string, boolean> | null) => void

  // Mobile diff modal actions
  openMobileDiff: () => void
  closeMobileDiff: () => void

  // Git history panel actions
  openGitHistory: () => void
  closeGitHistory: () => void
  toggleGitHistory: () => void
  triggerGitHistoryRefresh: () => void

  // Content panel actions
  openContentPanel: () => void
  closeContentPanel: () => void
  toggleContentPanel: () => void
  setContentPanelWidth: (width: number) => void
  addFileTab: (filePath: string, filename: string, makeActive?: boolean) => void
  addTerminalTab: (makeActive?: boolean) => void
  addServerTab: (port: number, url: string) => void
  removeServerTab: (port: number) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  clearContentPanelTabs: () => void

  // Desktop rebase conflict
  setDesktopRebaseConflict: (conflict: boolean) => void

  // Pending start commit
  setPendingStartCommit: (commit: string | null) => void
  clearPendingStartCommit: () => void

  // Pending repo from URL
  setPendingRepoFromUrl: (repo: { owner: string; name: string } | null) => void
  clearPendingRepoFromUrl: () => void

  // Reset all UI state
  resetUI: () => void
}

const initialState: UIState = {
  mobileSidebarOpen: false,
  mobileSandboxToggleLoading: false,
  mobilePrLoading: false,
  settingsOpen: false,
  settingsHighlightField: null,
  addRepoOpen: false,
  repoSettingsOpen: false,
  mobileDiffOpen: false,
  gitHistoryOpen: false,
  gitHistoryRefreshTrigger: 0,
  contentPanelOpen: false,
  contentPanelWidth: 400,
  contentPanelTabs: [],
  contentPanelActiveTabId: null,
  contentPanelTerminalCounter: 0,
  desktopRebaseConflict: false,
  repoEnvVars: null,
  pendingStartCommit: null,
  pendingRepoFromUrl: null,
}

const storeCreator = (set: (partial: Partial<UIState & UIActions>) => void, get: () => UIState & UIActions) => ({
  ...initialState,

  // Derived state helpers
  hasActiveServer: () => get().contentPanelTabs.some(t => t.type === "server"),

  // Sidebar actions
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  toggleMobileSidebar: () => set({ mobileSidebarOpen: !get().mobileSidebarOpen }),
  setMobileSidebarOpen: (open: boolean) => set({ mobileSidebarOpen: open }),

  // Loading actions
  setMobileSandboxToggleLoading: (loading: boolean) => set({ mobileSandboxToggleLoading: loading }),
  setMobilePrLoading: (loading: boolean) => set({ mobilePrLoading: loading }),

  // Settings modal actions
  openSettings: (highlightField?: string) =>
    set({ settingsOpen: true, settingsHighlightField: highlightField ?? null }),
  closeSettings: () => set({ settingsOpen: false, settingsHighlightField: null }),
  clearSettingsHighlight: () => set({ settingsHighlightField: null }),

  // Add repo modal actions
  openAddRepo: () => set({ addRepoOpen: true }),
  closeAddRepo: () => set({ addRepoOpen: false }),

  // Repo settings modal actions
  openRepoSettings: () => set({ repoSettingsOpen: true }),
  closeRepoSettings: () => set({ repoSettingsOpen: false, repoEnvVars: null }),
  setRepoEnvVars: (envVars: Record<string, boolean> | null) => set({ repoEnvVars: envVars }),

  // Mobile diff modal actions
  openMobileDiff: () => set({ mobileDiffOpen: true }),
  closeMobileDiff: () => set({ mobileDiffOpen: false }),

  // Git history panel actions
  openGitHistory: () => set({ gitHistoryOpen: true }),
  closeGitHistory: () => set({ gitHistoryOpen: false }),
  toggleGitHistory: () => set({ gitHistoryOpen: !get().gitHistoryOpen }),
  triggerGitHistoryRefresh: () => set({ gitHistoryRefreshTrigger: get().gitHistoryRefreshTrigger + 1 }),

  // Content panel actions
  openContentPanel: () => set({ contentPanelOpen: true }),
  closeContentPanel: () => set({ contentPanelOpen: false }),
  toggleContentPanel: () => set({ contentPanelOpen: !get().contentPanelOpen }),
  setContentPanelWidth: (width: number) => set({ contentPanelWidth: width }),

  addFileTab: (filePath: string, filename: string, makeActive = true) => {
    const state = get()
    const tabId = `file-${filePath}`
    const existingTab = state.contentPanelTabs.find(t => t.id === tabId)

    if (existingTab) {
      // Tab already exists, just make it active if requested
      if (makeActive) {
        set({ contentPanelActiveTabId: tabId })
      }
      return
    }

    const newTab: ContentPanelTab = {
      id: tabId,
      type: "file",
      filePath,
      filename,
    }

    const shouldMakeActive = makeActive || state.contentPanelTabs.length === 0
    set({
      contentPanelTabs: [...state.contentPanelTabs, newTab],
      contentPanelActiveTabId: shouldMakeActive ? tabId : state.contentPanelActiveTabId,
    })
  },

  addTerminalTab: (makeActive = true) => {
    const state = get()
    const terminalNum = state.contentPanelTerminalCounter + 1
    const tabId = `terminal-${terminalNum}`

    const newTab: ContentPanelTab = {
      id: tabId,
      type: "terminal",
      filename: `Terminal ${terminalNum}`,
    }

    set({
      contentPanelTabs: [...state.contentPanelTabs, newTab],
      contentPanelActiveTabId: makeActive ? tabId : state.contentPanelActiveTabId,
      contentPanelTerminalCounter: terminalNum,
    })
  },

  addServerTab: (port: number, url: string) => {
    const state = get()
    const tabId = `server-${port}`
    const existingTab = state.contentPanelTabs.find(t => t.id === tabId)

    if (existingTab) return // Already exists

    const newTab: ContentPanelTab = {
      id: tabId,
      type: "server",
      port,
      url,
      filename: `:${port}`,
    }

    // Add server tabs but don't change active tab
    set({
      contentPanelTabs: [...state.contentPanelTabs, newTab],
    })
  },

  removeServerTab: (port: number) => {
    const state = get()
    const tabId = `server-${port}`
    const newTabs = state.contentPanelTabs.filter(t => t.id !== tabId)

    // If we removed the active tab, switch to another
    let newActiveId = state.contentPanelActiveTabId
    if (state.contentPanelActiveTabId === tabId) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
    }

    set({
      contentPanelTabs: newTabs,
      contentPanelActiveTabId: newActiveId,
    })
  },

  closeTab: (tabId: string) => {
    const state = get()
    const tabIndex = state.contentPanelTabs.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return

    const newTabs = state.contentPanelTabs.filter(t => t.id !== tabId)

    // If we removed the active tab, switch to adjacent tab
    let newActiveId = state.contentPanelActiveTabId
    if (state.contentPanelActiveTabId === tabId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (tabIndex >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1].id
      } else {
        newActiveId = newTabs[tabIndex].id
      }
    }

    set({
      contentPanelTabs: newTabs,
      contentPanelActiveTabId: newActiveId,
    })
  },

  setActiveTab: (tabId: string) => set({ contentPanelActiveTabId: tabId }),

  clearContentPanelTabs: () => set({
    contentPanelTabs: [],
    contentPanelActiveTabId: null,
    contentPanelTerminalCounter: 0,
  }),

  // Desktop rebase conflict
  setDesktopRebaseConflict: (conflict: boolean) => set({ desktopRebaseConflict: conflict }),

  // Pending start commit
  setPendingStartCommit: (commit: string | null) => set({ pendingStartCommit: commit }),
  clearPendingStartCommit: () => set({ pendingStartCommit: null }),

  // Pending repo from URL
  setPendingRepoFromUrl: (repo: { owner: string; name: string } | null) => set({ pendingRepoFromUrl: repo }),
  clearPendingRepoFromUrl: () => set({ pendingRepoFromUrl: null }),

  // Reset all UI state
  resetUI: () => set(initialState),
})

// Only use devtools in development
export const useUIStore =
  process.env.NODE_ENV === "development"
    ? create<UIState & UIActions>()(devtools(storeCreator, { name: "ui-store" }))
    : create<UIState & UIActions>()(storeCreator)
