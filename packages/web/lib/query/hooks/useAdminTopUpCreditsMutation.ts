"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"

/**
 * Manual credit top-up (or correction) for a user, from the admin Users table.
 *
 * Hits the same endpoint the Stripe-less testing flow uses (see
 * app/api/admin/users/[userId]/credits/route.ts): a positive amount grants
 * credits, a negative one posts an adjustment. Both are ledgered.
 */
export interface TopUpCreditsParams {
  userId: string
  amountUsd: number
  note?: string
}

export interface TopUpCreditsResult {
  userId: string
  amountUsd: number
  type: "grant" | "adjustment"
  balanceUsd: number
}

async function topUpCredits({
  userId,
  amountUsd,
  note,
}: TopUpCreditsParams): Promise<TopUpCreditsResult> {
  const response = await fetch(`/api/admin/users/${userId}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountUsd, note }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || "Failed to update credit balance")
  }

  return response.json()
}

export function useAdminTopUpCreditsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: topUpCredits,
    onSuccess: () => {
      // Refreshes the balance shown in the Users table (and any other admin
      // view that reads it, e.g. the Leaderboard top-ups charts).
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    },
  })
}
