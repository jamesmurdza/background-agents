"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useCallback, useEffect } from "react"
import { useSession } from "next-auth/react"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"

/**
 * Sync data types - matches API response
 */
export interface SyncBranch {
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

export interface SyncRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: SyncBranch[]
}

export interface SyncData {
  timestamp: number
  repos: SyncRepo[]
}

interface UseSyncDataOptions {
  /**
   * Callback fired when sync data changes
   * Receives current data and previous data for comparison
   */
  onSyncData?: (data: SyncData, prevData: SyncData | null) => void
  /**
   * Whether syncing is enabled
   * @default true
   */
  enabled?: boolean
  /**
   * Polling interval in milliseconds
   * @default 5000
   */
  interval?: number
}

/**
 * Fetches sync data from the API
 */
async function fetchSyncData(): Promise<SyncData> {
  return apiFetch<SyncData>("/api/sync")
}

/**
 * Hook for cross-device sync polling using TanStack Query
 *
 * This replaces the useCrossDeviceSync hook with TanStack Query's
 * built-in polling capabilities.
 *
 * Features:
 * - Automatic polling at configurable interval
 * - Pauses when tab is hidden (refetchIntervalInBackground: false)
 * - Immediate refetch when tab becomes visible
 * - Change detection via onSyncData callback
 */
export function useSyncData(options: UseSyncDataOptions = {}) {
  const { onSyncData, enabled = true, interval = 5000 } = options
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  // Track previous data for change detection
  const prevDataRef = useRef<SyncData | null>(null)

  // Store callback in ref to avoid recreating query
  const onSyncDataRef = useRef(onSyncData)
  onSyncDataRef.current = onSyncData

  const query = useQuery({
    queryKey: queryKeys.sync.data(),
    queryFn: async () => {
      const data = await fetchSyncData()

      // Call handler with previous data for comparison
      if (onSyncDataRef.current) {
        onSyncDataRef.current(data, prevDataRef.current)
      }
      prevDataRef.current = data

      return data
    },
    enabled: enabled && isAuthenticated,
    // Polling configuration
    refetchInterval: interval,
    // Pause polling when tab is hidden
    refetchIntervalInBackground: false,
    // Refetch immediately when window regains focus
    refetchOnWindowFocus: true,
    // Data is considered fresh for slightly less than the polling interval
    staleTime: interval - 1000,
    // Don't retry on error - next poll will try again
    retry: false,
  })

  // Manual sync trigger
  const sync = useCallback(() => {
    query.refetch()
  }, [query])

  return {
    ...query,
    sync,
  }
}

/**
 * Hook to manually trigger a sync
 */
export function useManualSync() {
  const queryClient = useQueryClient()

  return useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
  }, [queryClient])
}
