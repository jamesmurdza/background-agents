"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../query-keys"
import { apiPost, apiDelete, apiPatch } from "../fetcher"
import type { Agent } from "@/lib/shared/types"

/**
 * Parameters for creating a branch
 */
interface CreateBranchParams {
  repoId: string
  name: string
  baseBranch: string
  agent?: Agent
  model?: string
  draftPrompt?: string
}

/**
 * Response from creating a branch
 */
interface CreateBranchResponse {
  branch: {
    id: string
    name: string
    status: string
  }
}

/**
 * Parameters for deleting a branch
 */
interface DeleteBranchParams {
  branchId: string
}

/**
 * Parameters for renaming a branch
 */
interface RenameBranchParams {
  branchId: string
  name: string
  hasCustomName?: boolean
}

/**
 * Mutation hook to create a branch
 */
export function useCreateBranch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateBranchParams) => {
      return apiPost<CreateBranchResponse>("/api/branches", params)
    },
    onSuccess: () => {
      // Invalidate user data to refresh branches list
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
      // Invalidate sync data
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
    },
    onError: (error) => {
      console.error("Failed to create branch:", error)
    },
  })
}

/**
 * Mutation hook to delete a branch
 */
export function useDeleteBranch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ branchId }: DeleteBranchParams) => {
      return apiDelete<{ success: boolean }>(`/api/branches?branchId=${branchId}`)
    },
    onSuccess: (_, variables) => {
      // Invalidate user data to refresh branches list
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
      // Invalidate sync data
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
      // Clear branch messages from cache
      queryClient.removeQueries({
        queryKey: queryKeys.branches.messages(variables.branchId),
      })
    },
    onError: (error) => {
      console.error("Failed to delete branch:", error)
    },
  })
}

/**
 * Mutation hook to rename a branch
 */
export function useRenameBranch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ branchId, name, hasCustomName }: RenameBranchParams) => {
      return apiPatch<{ success: boolean }>("/api/branches", {
        branchId,
        name,
        hasCustomName,
      })
    },
    onSuccess: () => {
      // Invalidate user data to refresh branch names
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
      // Invalidate sync data
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
    },
    onError: (error) => {
      console.error("Failed to rename branch:", error)
    },
  })
}
