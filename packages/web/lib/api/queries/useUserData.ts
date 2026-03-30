"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"
import {
  DbRepo,
  Quota,
  UserCredentials,
  TransformedRepo,
  transformRepo,
} from "@/lib/db/db-types"

/**
 * Response shape from /api/user/me
 */
interface UserMeResponse {
  user: {
    id: string
    name: string
    email: string
    isAdmin?: boolean
  }
  repos: DbRepo[]
  quota: Quota
  credentials: UserCredentials
}

/**
 * Transformed user data for consumption by components
 */
export interface UserData {
  user: {
    id: string
    name: string
    email: string
    isAdmin: boolean
  }
  repos: TransformedRepo[]
  quota: Quota
  credentials: UserCredentials
}

/**
 * Fetches and transforms user data from /api/user/me
 */
async function fetchUserData(): Promise<UserData> {
  const data = await apiFetch<UserMeResponse>("/api/user/me", {
    // Ensure fresh data
    headers: {
      "Cache-Control": "no-cache",
    },
  })

  return {
    user: {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      isAdmin: data.user.isAdmin ?? false,
    },
    repos: data.repos.map(transformRepo),
    quota: data.quota,
    credentials: data.credentials,
  }
}

/**
 * Hook to fetch current user data including repos, quota, and credentials
 *
 * This is the primary data-fetching hook for the application.
 * It replaces the useRepoData hook's initial fetch logic.
 */
export function useUserData() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.user.me(),
    queryFn: fetchUserData,
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // Consider fresh for 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })
}

/**
 * Hook to access just the quota data
 */
export function useQuota() {
  const { data, ...rest } = useUserData()
  return {
    ...rest,
    data: data?.quota ?? null,
  }
}

/**
 * Hook to access just the credentials data
 */
export function useCredentials() {
  const { data, ...rest } = useUserData()
  return {
    ...rest,
    data: data?.credentials ?? null,
  }
}

/**
 * Hook to access just the repos data
 */
export function useRepos() {
  const { data, ...rest } = useUserData()
  return {
    ...rest,
    data: data?.repos ?? [],
  }
}

/**
 * Hook for imperatively refreshing user data
 */
export function useRefreshUserData() {
  const queryClient = useQueryClient()

  return {
    /**
     * Refresh all user data (repos, quota, credentials)
     */
    refreshAll: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() }),

    /**
     * Refresh just the quota
     * Note: Since quota is part of /api/user/me, this refreshes all user data
     */
    refreshQuota: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() }),

    /**
     * Refresh just the credentials
     * Note: Since credentials are part of /api/user/me, this refreshes all user data
     */
    refreshCredentials: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() }),

    /**
     * Update repos in the cache without refetching
     */
    setRepos: (updater: (repos: TransformedRepo[]) => TransformedRepo[]) => {
      queryClient.setQueryData<UserData>(queryKeys.user.me(), (old) => {
        if (!old) return old
        return {
          ...old,
          repos: updater(old.repos),
        }
      })
    },

    /**
     * Update quota in the cache without refetching
     */
    setQuota: (quota: Quota) => {
      queryClient.setQueryData<UserData>(queryKeys.user.me(), (old) => {
        if (!old) return old
        return {
          ...old,
          quota,
        }
      })
    },
  }
}

/**
 * Get the current user data from the cache (for use outside of React components)
 */
export function getUserDataFromCache(
  queryClient: ReturnType<typeof useQueryClient>
): UserData | undefined {
  return queryClient.getQueryData<UserData>(queryKeys.user.me())
}
