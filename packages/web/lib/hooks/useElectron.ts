/**
 * Hook for accessing Electron APIs when running in the desktop app
 */

import { useEffect, useCallback, useState } from "react"

// License auto-detection result type
export interface LicenseDetectResult {
  found: boolean
  credentials: string | null
  source: "keychain" | "file" | null
  error?: string
}

// License detection settings type
export interface LicenseDetectSettings {
  autoDetectEnabled: boolean
}

// Local repo sync (Backgrounder folder) types
export interface GitSyncSettings {
  rootDirectory: string
}

export type RepoSyncState = "idle" | "cloning" | "syncing" | "ready" | "error"

export interface SyncStatusEvent {
  repo: string
  status: RepoSyncState
  message?: string
}

export interface SyncErrorEvent {
  repo: string
  branch?: string
  message: string
}

// Type definitions for Electron IPC bridge
interface ElectronAPI {
  platform: string
  showNotification: (options: { title: string; body: string; chatId?: string }) => void
  updateBadge: (count: number) => void
  toggleWindow: () => void
  getAuthToken: () => Promise<string | null>
  setAuthToken: (token: string) => Promise<boolean>
  openExternal: (url: string) => void
  getClaudeLicenseAutoDetect: () => Promise<LicenseDetectResult>
  getLicenseDetectSettings: () => Promise<LicenseDetectSettings>
  setLicenseDetectSettings: (settings: LicenseDetectSettings) => Promise<boolean>
  // Local repo sync (Backgrounder folder)
  getGitSyncSettings: () => Promise<GitSyncSettings>
  setGitSyncSettings: (settings: GitSyncSettings) => Promise<GitSyncSettings>
  pickSyncDirectory: () => Promise<string | null>
  getRepoSyncState: (repo: string) => Promise<{ cloned: boolean }>
  openRepoFolder: (data: { repo: string; branches: string[]; activeBranch: string | null }) => Promise<{ success: boolean; error?: string }>
  setActiveChat: (data: { repo: string; branch: string | null }) => Promise<{ success: boolean }>
  syncBranch: (data: { repo: string; branch: string }) => Promise<{ success: boolean }>
  onDeepLink: (callback: (data: { action: string; params: Record<string, string> }) => void) => () => void
  onNavigateToChat: (callback: (chatId: string) => void) => () => void
  onGitPushed: (callback: (data: { repo: string; branch: string; commitSha: string }) => void) => () => void
  onShortcut: (callback: (action: string) => void) => () => void
  onSyncStatus: (callback: (data: SyncStatusEvent) => void) => () => void
  onSyncError: (callback: (data: SyncErrorEvent) => void) => () => void
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electron
}

/**
 * Get the Electron API if available
 */
export function getElectronAPI(): ElectronAPI | null {
  if (typeof window !== "undefined" && window.electron) {
    return window.electron
  }
  return null
}

/**
 * Hook for Electron features
 */
export function useElectron() {
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const api = getElectronAPI()

  useEffect(() => {
    setIsDesktopApp(isElectron())
  }, [])

  /**
   * Show a native notification
   */
  const showNotification = useCallback((title: string, body: string, chatId?: string) => {
    if (api) {
      api.showNotification({ title, body, chatId })
    } else if (typeof window !== "undefined" && "Notification" in window) {
      // Fallback to web notifications
      if (Notification.permission === "granted") {
        new Notification(title, { body })
      }
    }
  }, [api])

  /**
   * Update badge count (dock/taskbar)
   */
  const updateBadge = useCallback((count: number) => {
    api?.updateBadge(count)
  }, [api])

  /**
   * Open URL in external browser
   */
  const openExternal = useCallback((url: string) => {
    if (api) {
      api.openExternal(url)
    } else {
      window.open(url, "_blank")
    }
  }, [api])

  /**
   * Get auto-detected Claude Code credentials (desktop only)
   */
  const getClaudeLicenseAutoDetect = useCallback(async (): Promise<LicenseDetectResult | null> => {
    if (!api) return null
    try {
      return await api.getClaudeLicenseAutoDetect()
    } catch (error) {
      console.error("Failed to get auto-detected license:", error)
      return null
    }
  }, [api])

  /**
   * Get license detection settings (desktop only)
   */
  const getLicenseDetectSettings = useCallback(async (): Promise<LicenseDetectSettings | null> => {
    if (!api) return null
    try {
      return await api.getLicenseDetectSettings()
    } catch (error) {
      console.error("Failed to get license detect settings:", error)
      return null
    }
  }, [api])

  /**
   * Update license detection settings (desktop only)
   */
  const setLicenseDetectSettings = useCallback(async (settings: LicenseDetectSettings): Promise<boolean> => {
    if (!api) return false
    try {
      return await api.setLicenseDetectSettings(settings)
    } catch (error) {
      console.error("Failed to set license detect settings:", error)
      return false
    }
  }, [api])

  return {
    isDesktopApp,
    platform: api?.platform || (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
    showNotification,
    updateBadge,
    openExternal,
    getClaudeLicenseAutoDetect,
    getLicenseDetectSettings,
    setLicenseDetectSettings,
    api,
  }
}
