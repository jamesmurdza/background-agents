"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../query-keys"
import { apiPatch } from "../fetcher"
import type { Branch } from "@/lib/shared/types"

interface UpdateBranchParams {
  branchId: string
  updates: Partial<Branch>
}

interface UpdateBranchResponse {
  success: boolean
}

/**
 * Mutation hook to update a branch
 *
 * Handles optimistic updates and cache invalidation.
 */
export function useUpdateBranch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ branchId, updates }: UpdateBranchParams) => {
      return apiPatch<UpdateBranchResponse>("/api/branches", {
        branchId,
        ...updates,
      })
    },
    onSuccess: () => {
      // Invalidate user data to refresh repos/branches
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
      // Invalidate sync data
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
    },
    onError: (error) => {
      console.error("Failed to update branch:", error)
    },
  })
}

/**
 * Hook to save draft prompt for a branch
 */
export function useSaveDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      branchId,
      draftPrompt,
    }: {
      branchId: string
      draftPrompt: string
    }) => {
      return apiPatch<UpdateBranchResponse>("/api/branches", {
        branchId,
        draftPrompt,
      })
    },
    // Don't invalidate on draft save - it's just a background persist
    onError: (error) => {
      console.error("Failed to save draft:", error)
    },
  })
}
