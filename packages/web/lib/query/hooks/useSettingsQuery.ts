"use client"

import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { fetchSettings, fetchSharedPoolFlags } from "@/lib/sync/api"
import type { Settings, CredentialFlags, CustomEndpoint } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

export interface SettingsData {
  settings: Settings
  credentialFlags: CredentialFlags
  customEndpoints?: CustomEndpoint[]
  claudeLimitResetAt?: string | null
  claudeLimitRemaining?: number | null
  claudeLimitUsed?: number | null
  claudeLimitTotal?: number | null
  claudeIsPro?: boolean
  claudeIsWeekly?: boolean
}

/**
 * Fetches user settings and credential flags.
 *
 * Authenticated: the full user settings + effective credential flags.
 * Logged out: only the public shared-pool flags (server config, no user data),
 * so the agent picker can still show shared-pool "ready" dots before sign-in.
 * The auth state is part of the query key so login/logout refetches the right
 * source.
 */
export function useSettingsQuery() {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id
  const queryClient = useQueryClient()

  // The data source flips with auth (authed settings vs public shared-pool
  // flags), but the cache key stays queryKeys.settings.all so the optimistic
  // writers (settings mutation, Claude-usage decrement) keep hitting it. Refetch
  // on the transition so a login/logout swaps the data instead of serving the
  // previous state until it goes stale.
  useEffect(() => {
    if (status === "loading") return
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
  }, [isAuthenticated, status, queryClient])

  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: async (): Promise<SettingsData> => {
      if (!isAuthenticated) {
        // Logged out: settings stay at defaults; only shared-pool flags are real.
        const { credentialFlags } = await fetchSharedPoolFlags()
        return { settings: DEFAULT_SETTINGS, credentialFlags }
      }
      const response = await fetchSettings()
      return {
        settings: response.settings,
        credentialFlags: response.credentialFlags,
        customEndpoints: response.customEndpoints,
        claudeLimitResetAt: response.claudeLimitResetAt,
        claudeLimitRemaining: response.claudeLimitRemaining,
        claudeLimitUsed: response.claudeLimitUsed,
        claudeLimitTotal: response.claudeLimitTotal,
        claudeIsPro: response.claudeIsPro,
        claudeIsWeekly: response.claudeIsWeekly,
      }
    },
    // Wait until NextAuth resolves so we don't fetch the anon endpoint for a
    // user who is actually signed in (which would flash the wrong dots).
    enabled: status !== "loading",
    staleTime: 60 * 1000, // 1 minute - settings don't change often
    // Provide default values while loading
    placeholderData: {
      settings: DEFAULT_SETTINGS,
      credentialFlags: {},
    },
  })
}
