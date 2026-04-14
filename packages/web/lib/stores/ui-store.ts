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
import { devtools, persist, createJSONStorage } from "zustand/middleware"

// Content Panel tab types
export interface ContentPanelTab {
  id: string                      // "file-{path}", "terminal-{n}", or "server-{port}"
  type: "file" | "terminal" | "server"
  filePath?: string               // For file tabs
  filename?: string               // Display name
  port?: number                   // For server tabs
  url?: string                    // For server tabs
  websocketUrl?: string           // For terminal tabs (WebSocket PTY URL).
                                  // Sandbox-specific signed URL — may be stale
                                  // if restored from a snapshot of a defunct
                                  // or paused sandbox; the tab will reconnect
                                  // and show Disconnected if so.
}

export interface ContentPanelTabSnapshot {
  tabs: ContentPanelTab[]
  activeId: string | null
  terminalCounter: number
  panelOpen: boolean
  panelCollapsed: boolean
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
  contentPanelCollapsed: boolean  // Panel is open but view is hidden (dragged to edge)
  contentPanelWidth: number
  contentPanelTabs: ContentPanelTab[]
  contentPanelActiveTabId: string | null
  contentPanelTerminalCounter: number
  // Per-context (repo+branch) snapshot of tabs, so switching branches/repos
  // restores the tabs you had open last time you were in that context.
  contentPanelTabSnapshots: Record<string, ContentPanelTabSnapshot>
  // The cacheKey the live contentPanelTabs/active/counter fields belong to.
  currentTabsCacheKey: string | null

  // Desktop rebase conflict indicator
  desktopRebaseConflict: boolean

  // Repo settings data
  repoEnvVars: Record<string, boolean> | null

  // Pending state
  pendingStartCommit: string | null

  // Pending repo from URL (when user visits /owner/repo that isn't in their list)
  pendingRepoFromUrl: { owner: string; name: string } | null

  // Pending command from command palette (merge, rebase, pr)
  pendingCommand: string | null
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
  setContentPanelCollapsed: (collapsed: boolean) => void
  setContentPanelWidth: (width: number) => void
  addFileTab: (filePath: string, filename: string, makeActive?: boolean) => void
  addTerminalTab: (makeActive?: boolean) => void
  addServerTab: (port: number, url: string) => void
  removeServerTab: (port: number) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setTerminalWebsocketUrl: (tabId: string, websocketUrl: string) => void
  clearContentPanelTabs: () => void
  // Snapshot the current tabs under the previous cacheKey and load whatever's
  // stored under the new cacheKey. Called by ContentPanel when its cacheKey
  // (repo+branch identity) changes.
  switchContentPanelContext: (cacheKey: string) => void

  // Desktop rebase conflict
  setDesktopRebaseConflict: (conflict: boolean) => void

  // Pending start commit
  setPendingStartCommit: (commit: string | null) => void
  clearPendingStartCommit: () => void

  // Pending repo from URL
  setPendingRepoFromUrl: (repo: { owner: string; name: string } | null) => void
  clearPendingRepoFromUrl: () => void

  // Pending command from command palette
  setPendingCommand: (command: string | null) => void
  clearPendingCommand: () => void

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
  contentPanelCollapsed: false,
  contentPanelWidth: 400,
  contentPanelTabs: [],
  contentPanelActiveTabId: null,
  contentPanelTerminalCounter: 0,
  contentPanelTabSnapshots: {},
  currentTabsCacheKey: null,
  desktopRebaseConflict: false,
  repoEnvVars: null,
  pendingStartCommit: null,
  pendingRepoFromUrl: null,
  pendingCommand: null,
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
  openContentPanel: () => set({ contentPanelOpen: true, contentPanelCollapsed: false }),
  closeContentPanel: () => set({ contentPanelOpen: false, contentPanelCollapsed: false }),
  toggleContentPanel: () => set({ contentPanelOpen: !get().contentPanelOpen }),
  setContentPanelCollapsed: (collapsed: boolean) => set({ contentPanelCollapsed: collapsed }),
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

  setTerminalWebsocketUrl: (tabId: string, websocketUrl: string) => {
    const state = get()
    const newTabs = state.contentPanelTabs.map(tab =>
      tab.id === tabId ? { ...tab, websocketUrl } : tab
    )
    set({ contentPanelTabs: newTabs })
  },

  clearContentPanelTabs: () => set({
    contentPanelTabs: [],
    contentPanelActiveTabId: null,
    contentPanelTerminalCounter: 0,
  }),

  switchContentPanelContext: (cacheKey: string) => {
    const state = get()
    const previousKey = state.currentTabsCacheKey

    // Snapshot the live tabs under the previous key (if any). We do this even
    // when the key hasn't actually changed so that the snapshot stays in sync
    // with whatever the user has done since the last switch (important for
    // localStorage persistence across reloads).
    const nextSnapshots = { ...state.contentPanelTabSnapshots }
    if (previousKey !== null) {
      nextSnapshots[previousKey] = {
        tabs: state.contentPanelTabs,
        activeId: state.contentPanelActiveTabId,
        terminalCounter: state.contentPanelTerminalCounter,
        panelOpen: state.contentPanelOpen,
        panelCollapsed: state.contentPanelCollapsed,
      }
    }

    const restored = nextSnapshots[cacheKey]
    set({
      contentPanelTabSnapshots: nextSnapshots,
      currentTabsCacheKey: cacheKey,
      contentPanelTabs: restored?.tabs ?? [],
      contentPanelActiveTabId: restored?.activeId ?? null,
      contentPanelTerminalCounter: restored?.terminalCounter ?? 0,
      contentPanelOpen: restored?.panelOpen ?? false,
      contentPanelCollapsed: restored?.panelCollapsed ?? false,
    })
  },

  // Desktop rebase conflict
  setDesktopRebaseConflict: (conflict: boolean) => set({ desktopRebaseConflict: conflict }),

  // Pending start commit
  setPendingStartCommit: (commit: string | null) => set({ pendingStartCommit: commit }),
  clearPendingStartCommit: () => set({ pendingStartCommit: null }),

  // Pending repo from URL
  setPendingRepoFromUrl: (repo: { owner: string; name: string } | null) => set({ pendingRepoFromUrl: repo }),
  clearPendingRepoFromUrl: () => set({ pendingRepoFromUrl: null }),

  // Pending command from command palette
  setPendingCommand: (command: string | null) => set({ pendingCommand: command }),
  clearPendingCommand: () => set({ pendingCommand: null }),

  // Reset all UI state
  resetUI: () => set(initialState),
})

const persistOptions = {
  name: "ui-store",
  storage: createJSONStorage(() => localStorage),
  partialize: (state: UIState & UIActions) => ({
    contentPanelOpen: state.contentPanelOpen,
    contentPanelCollapsed: state.contentPanelCollapsed,
    contentPanelWidth: state.contentPanelWidth,
    // Persist tabs across reloads. We save both the live fields (for the
    // currently visible context) and the snapshot map (for every other
    // context the user has visited), so a reload restores exactly what was
    // on screen and switching branches still pulls from history.
    contentPanelTabs: state.contentPanelTabs,
    contentPanelActiveTabId: state.contentPanelActiveTabId,
    contentPanelTerminalCounter: state.contentPanelTerminalCounter,
    contentPanelTabSnapshots: state.contentPanelTabSnapshots,
    currentTabsCacheKey: state.currentTabsCacheKey,
  }),
  skipHydration: true,
}

export const useUIStore =
  process.env.NODE_ENV === "development"
    ? create<UIState & UIActions>()(devtools(persist(storeCreator, persistOptions), { name: "ui-store" }))
    : create<UIState & UIActions>()(persist(storeCreator, persistOptions))
