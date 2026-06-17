"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { updateSettings as apiUpdateSettings } from "@/lib/sync/api"
import type { Settings } from "@/lib/types"
import type { Credentials } from "@/lib/credentials"
import type { SettingsData } from "./useSettingsQuery"

interface UpdateSettingsParams {
  settings?: Partial<Settings>
  credentials?: Credentials
}

/**
 * Updates user settings and/or credentials.
 * Optimistically updates the cache.
 */
export function useUpdateSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: UpdateSettingsParams) => {
      return apiUpdateSettings(params)
    },
    onMutate: async (params) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.settings.all })

      // Snapshot previous value
      const previousSettings = queryClient.getQueryData<SettingsData>(
        queryKeys.settings.all
      )

      // Optimistically update settings (only the settings part, not credentials)
      if (previousSettings && params.settings) {
        queryClient.setQueryData<SettingsData>(queryKeys.settings.all, {
          ...previousSettings,
          settings: {
            ...previousSettings.settings,
            ...params.settings,
          },
        })
      }

      return { previousSettings }
    },
    onSuccess: (response) => {
      // Update with the full server response. Must carry every field —
      // dropping any (e.g. credentialValues or the claudeLimit* fields) would
      // blank it in the cache until the next refetch.
      queryClient.setQueryData<SettingsData>(queryKeys.settings.all, {
        settings: response.settings,
        credentialFlags: response.credentialFlags,
        credentialValues: response.credentialValues,
        claudeLimitResetAt: response.claudeLimitResetAt,
        claudeLimitRemaining: response.claudeLimitRemaining,
        claudeLimitUsed: response.claudeLimitUsed,
        claudeLimitTotal: response.claudeLimitTotal,
        claudeIsPro: response.claudeIsPro,
        claudeIsWeekly: response.claudeIsWeekly,
      })
    },
    onError: (err, _, context) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKeys.settings.all, context.previousSettings)
      }
      console.error("Failed to update settings:", err)
    },
  })
}
