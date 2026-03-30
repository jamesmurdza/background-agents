"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../query-keys"
import { apiPost, apiDelete } from "../fetcher"

/**
 * Parameters for creating a repo
 */
interface CreateRepoParams {
  owner: string
  name: string
  avatar?: string
  defaultBranch?: string
}

/**
 * Response from creating a repo
 */
interface CreateRepoResponse {
  repo: {
    id: string
    name: string
    owner: string
    avatar: string
    defaultBranch: string
  }
}

/**
 * Parameters for deleting a repo
 */
interface DeleteRepoParams {
  repoId: string
}

/**
 * Mutation hook to create/add a repo
 */
export function useCreateRepo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateRepoParams) => {
      return apiPost<CreateRepoResponse>("/api/repos", params)
    },
    onSuccess: () => {
      // Invalidate user data to refresh repos list
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
    },
    onError: (error) => {
      console.error("Failed to create repo:", error)
    },
  })
}

/**
 * Mutation hook to delete a repo
 */
export function useDeleteRepo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ repoId }: DeleteRepoParams) => {
      return apiDelete<{ success: boolean }>(`/api/repos?repoId=${repoId}`)
    },
    onSuccess: () => {
      // Invalidate user data to refresh repos list
      queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
      // Invalidate sync data
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
    },
    onError: (error) => {
      console.error("Failed to delete repo:", error)
    },
  })
}

/**
 * Mutation hook to update repo order
 */
export function useUpdateRepoOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (repoIds: string[]) => {
      return apiPost<{ success: boolean }>("/api/user/repo-order", { repoIds })
    },
    // Don't invalidate - local state handles the reorder
    onError: (error) => {
      console.error("Failed to update repo order:", error)
    },
  })
}
