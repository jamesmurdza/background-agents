/**
 * Hook for accessing Electron APIs when running in the desktop app
 */

import { useEffect, useCallback, useState } from "react"

// Type definitions for Electron IPC bridge
interface ElectronAPI {
  platform: string
  showNotification: (options: { title: string; body: string; chatId?: string }) => void
  updateBadge: (count: number) => void
  toggleWindow: () => void
  getAuthToken: () => Promise<string | null>
  setAuthToken: (token: string) => Promise<boolean>
  openExternal: (url: string) => void
  getGitSyncSettings: () => Promise<GitSyncSettings>
  setGitSyncSettings: (settings: GitSyncSettings) => Promise<boolean>
  onDeepLink: (callback: (data: { action: string; params: Record<string, string> }) => void) => () => void
  onNavigateToChat: (callback: (chatId: string) => void) => () => void
  onGitPushed: (callback: (data: { repo: string; branch: string; commitSha: string }) => void) => () => void
  onShortcut: (callback: (action: string) => void) => () => void
}

interface GitSyncSettings {
  enabled: boolean
  syncDirectory: string
  autoSync: boolean
  bidirectionalSync: boolean
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

  return {
    isDesktopApp,
    platform: api?.platform || (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
    showNotification,
    updateBadge,
    openExternal,
    api,
  }
}

/**
 * Hook to listen for deep link navigation
 */
export function useDeepLinkNavigation(onNavigate: (chatId: string) => void) {
  useEffect(() => {
    const api = getElectronAPI()
    if (!api) return

    const cleanup = api.onNavigateToChat(onNavigate)
    return cleanup
  }, [onNavigate])
}

/**
 * Hook to listen for shortcuts
 */
export function useElectronShortcuts(handlers: {
  onNewChat?: () => void
  onSearch?: () => void
  onSettings?: () => void
}) {
  useEffect(() => {
    const api = getElectronAPI()
    if (!api) return

    const cleanup = api.onShortcut((action) => {
      switch (action) {
        case "new-chat":
          handlers.onNewChat?.()
          break
        case "search":
          handlers.onSearch?.()
          break
        case "settings":
          handlers.onSettings?.()
          break
      }
    })

    return cleanup
  }, [handlers])
}

/**
 * Hook for git sync settings
 */
export function useGitSyncSettings() {
  const [settings, setSettings] = useState<GitSyncSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const api = getElectronAPI()

  useEffect(() => {
    if (!api) {
      setLoading(false)
      return
    }

    api.getGitSyncSettings().then((s) => {
      setSettings(s)
      setLoading(false)
    })
  }, [api])

  const updateSettings = useCallback(async (newSettings: Partial<GitSyncSettings>) => {
    if (!api || !settings) return false

    const updated = { ...settings, ...newSettings }
    const success = await api.setGitSyncSettings(updated)
    if (success) {
      setSettings(updated)
    }
    return success
  }, [api, settings])

  return { settings, loading, updateSettings, isAvailable: !!api }
}
