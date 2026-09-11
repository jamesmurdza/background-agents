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
  planIsPro?: boolean
  /**
   * Purchased credits in USD, or null when the balance doesn't gate this user
   * (unlimited plan, own keys everywhere) — and always null when logged out,
   * since the anonymous shared-pool endpoint carries no user data.
   */
  creditBalanceUsd?: number | null
  /**
   * Admin-editable pricing multiplier per provider (see lib/db/provider-pricing
   * and the /admin Pricing panel), keyed the same way TokenUsage.provider is.
   * Empty when logged out — the anonymous shared-pool endpoint carries no
   * pricing data — which AgentModelSelector reads the same way as a missing
   * key: list price (DEFAULT_MULTIPLIER).
   */
  providerMultipliers?: Record<string, number>
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
        return { settings: DEFAULT_SETTINGS, credentialFlags, creditBalanceUsd: null }
      }
      const response = await fetchSettings()
      return {
        settings: response.settings,
        credentialFlags: response.credentialFlags,
        customEndpoints: response.customEndpoints,
        planIsPro: response.planIsPro,
        creditBalanceUsd: response.creditBalanceUsd ?? null,
        providerMultipliers: response.providerMultipliers ?? {},
      }
    },
    // Wait until NextAuth resolves so we don't fetch the anon endpoint for a
    // user who is actually signed in (which would flash the wrong dots).
    enabled: status !== "loading",
    staleTime: 60 * 1000, // 1 minute - settings don't change often
    // Opt back in to the focus refetch that QueryProvider turns off globally.
    // This query carries the credit balance, which moves without this tab
    // doing anything: a turn finished by the agent-lifecycle cron with no
    // stream attached, the daily refill at UTC midnight, a top-up completed in
    // another tab. Coming back to the tab is exactly when a stale balance is
    // most likely and most misleading — a green dot over a balance the server
    // will refuse. The staleTime above is what keeps it cheap: flicking
    // between tabs refetches at most once a minute.
    refetchOnWindowFocus: true,
    // Provide default values while loading
    placeholderData: {
      settings: DEFAULT_SETTINGS,
      credentialFlags: {},
      // Null, not 0: the placeholder must not flash "out of credits" at a user
      // whose balance simply hasn't loaded yet.
      creditBalanceUsd: null,
    },
  })
}
