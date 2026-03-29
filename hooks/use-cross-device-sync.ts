"use client"

import { useEffect, useRef, useCallback } from "react"

interface SyncBranch {
  id: string
  name: string
  status: string
  baseBranch: string | null
  prUrl: string | null
  agent: string | null
  model: string | null
  sandboxId: string | null
  sandboxStatus: string | null
  lastMessageId: string | null
  lastMessageAt: number | null
}

interface SyncRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: SyncBranch[]
}

interface SyncData {
  timestamp: number
  repos: SyncRepo[]
}

interface UseCrossDeviceSyncOptions {
  enabled?: boolean
  interval?: number // polling interval in ms
  onSyncData?: (data: SyncData, lastData: SyncData | null) => void
}

export function useCrossDeviceSync({
  enabled = true,
  interval = 5000, // 5 seconds default
  onSyncData,
}: UseCrossDeviceSyncOptions) {
  const lastSyncRef = useRef<SyncData | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const isVisibleRef = useRef(true)

  const sync = useCallback(async () => {
    if (!enabled || !isVisibleRef.current) return

    try {
      const res = await fetch("/api/sync")
      if (!res.ok) return

      const data: SyncData = await res.json()
      const lastSync = lastSyncRef.current

      // Call the sync handler with both current and last data
      // Let the consumer decide what changed and how to handle it
      onSyncData?.(data, lastSync)

      lastSyncRef.current = data
    } catch {
      // Silently fail - network issues are expected
    }
  }, [enabled, onSyncData])

  // Handle visibility changes - pause polling when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === "visible"

      // If becoming visible, sync immediately
      if (isVisibleRef.current) {
        sync()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [sync])

  // Start/stop polling
  useEffect(() => {
    if (!enabled) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      lastSyncRef.current = null
      return
    }

    // Initial sync
    sync()

    // Start polling
    pollingRef.current = setInterval(sync, interval)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [enabled, interval, sync])

  return { sync }
}
