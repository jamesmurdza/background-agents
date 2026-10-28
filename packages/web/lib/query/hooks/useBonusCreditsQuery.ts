"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"
import type { BonusCreditRequest } from "@/lib/bonus-credits"
import { extractErrorMessage } from "@/lib/fetch-error"

export interface BonusCreditGrant {
  id: string
  amountUsd: number
  reason: string
  note: string | null
  reference: string | null
  target: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string | null; image: string | null }
}

export interface GrantBonusCreditsResult {
  batchId: string
  granted: number
  skipped: number
  failed: number
  failedUserIds: string[]
  notFound: string[]
  totalUsd: number
}

/** Recent bonus grants (stars, PRs, issues, …), newest first. */
export function useBonusCreditsQuery() {
  const { status } = useSession()

  return useQuery({
    queryKey: queryKeys.admin.bonusCredits(),
    queryFn: () =>
      fetchAdminJson<{ grants: BonusCreditGrant[] }>("/api/admin/credits", "bonus credits"),
    enabled: status === "authenticated",
    staleTime: 30 * 1000,
    retry: adminRetry,
  })
}

async function grantBonusCredits(params: BonusCreditRequest): Promise<GrantBonusCreditsResult> {
  const response = await fetch("/api/admin/credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Failed to grant credits"))
  }
  return response.json()
}

export function useGrantBonusCreditsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: grantBonusCredits,
    onSuccess: () => {
      // The history here, and the Leaderboard's balances, all read the same
      // ledger — refresh every admin query rather than guessing which.
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    },
  })
}
