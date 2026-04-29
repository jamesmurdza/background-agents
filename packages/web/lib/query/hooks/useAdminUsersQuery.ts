"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"

interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  githubId: string | null
  isAdmin: boolean
  totalChats: number
  lastActivityAt: string | null
  lastActivityAction: string | null
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface AdminUsersResponse {
  users: User[]
  pagination: Pagination
}

interface UseAdminUsersQueryOptions {
  page?: number
  limit?: number
  search?: string
}

async function fetchAdminUsers(
  options: UseAdminUsersQueryOptions
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams()
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())
  if (options.search) params.set("search", options.search)

  const response = await fetch(`/api/admin/users?${params}`)
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Forbidden: Admin access required")
    }
    throw new Error("Failed to fetch admin users")
  }
  return response.json()
}

export function useAdminUsersQuery(options: UseAdminUsersQueryOptions = {}) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"
  const page = options.page ?? 1

  return useQuery({
    queryKey: queryKeys.admin.users(page, options.search),
    queryFn: () => fetchAdminUsers(options),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("Forbidden")) {
        return false
      }
      return failureCount < 3
    },
  })
}

// Mutation for updating user admin status
interface UpdateUserParams {
  userId: string
  isAdmin: boolean
}

async function updateUser({ userId, isAdmin }: UpdateUserParams): Promise<User> {
  const response = await fetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to update user")
  }

  const data = await response.json()
  return data.user
}

export function useUpdateUserMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      // Invalidate all admin queries to refresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    },
  })
}
