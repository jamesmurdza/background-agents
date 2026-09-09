"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"

export interface ProviderPricingRow {
  provider: string
  /** Charged = list value * multiplier. 0 makes the provider free. */
  multiplier: number
  updatedAt: string | null
  updatedBy: string | null
}

interface ProviderPricingResponse {
  providers: ProviderPricingRow[]
}

async function fetchProviderPricing(): Promise<ProviderPricingResponse> {
  return fetchAdminJson<ProviderPricingResponse>("/api/admin/provider-pricing", "provider pricing")
}

/** The admin-editable multiplier for every shared-pool provider. */
export function useProviderPricingQuery() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.providerPricing(),
    queryFn: fetchProviderPricing,
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    retry: adminRetry,
  })
}

interface SetProviderMultiplierParams {
  provider: string
  multiplier: number
}

async function setProviderMultiplier({
  provider,
  multiplier,
}: SetProviderMultiplierParams): Promise<{ provider: string; multiplier: number }> {
  const response = await fetch("/api/admin/provider-pricing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, multiplier }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to update provider pricing")
  }

  return response.json()
}

export function useSetProviderMultiplierMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setProviderMultiplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.providerPricing() })
    },
  })
}
