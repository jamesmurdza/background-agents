"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { fetchSettings } from "@/lib/sync/api"
import type { Settings, CredentialFlags, CredentialId } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

export interface SettingsData {
  settings: Settings
  credentialFlags: CredentialFlags
  credentialValues?: Partial<Record<CredentialId, string>>
  claudeLimitResetAt?: string | null
  claudeLimitRemaining?: number | null
  claudeLimitUsed?: number | null
  claudeLimitTotal?: number | null
  claudeIsPro?: boolean
  claudeIsWeekly?: boolean
}

/**
 * Fetches user settings and credential flags.
 * Only enabled when authenticated.
 */
export function useSettingsQuery() {
  const { data: session, status } = useSession()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: async (): Promise<SettingsData> => {
      const response = await fetchSettings()
      return {
        settings: response.settings,
        credentialFlags: response.credentialFlags,
        credentialValues: response.credentialValues,
        claudeLimitResetAt: response.claudeLimitResetAt,
        claudeLimitRemaining: response.claudeLimitRemaining,
        claudeLimitUsed: response.claudeLimitUsed,
        claudeLimitTotal: response.claudeLimitTotal,
        claudeIsPro: response.claudeIsPro,
        claudeIsWeekly: response.claudeIsWeekly,
      }
    },
    enabled: isAuthenticated,
    staleTime: 60 * 1000, // 1 minute - settings don't change often
    // Provide default values while loading
    placeholderData: {
      settings: DEFAULT_SETTINGS,
      credentialFlags: {},
    },
  })
}

/**
 * Get just the settings (convenience hook)
 */
export function useSettings() {
  const { data } = useSettingsQuery()
  return data?.settings ?? DEFAULT_SETTINGS
}

/**
 * Get just the credential flags (convenience hook)
 */
export function useCredentialFlags() {
  const { data } = useSettingsQuery()
  return data?.credentialFlags ?? {}
}
