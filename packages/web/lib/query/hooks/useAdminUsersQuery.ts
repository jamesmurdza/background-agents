"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import type { Plan } from "@/lib/server/usage-budgets"

interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  githubId: string | null
  isAdmin: boolean
  plan: Plan
  totalMessages: number
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

export type SortField = "name" | "email" | "totalMessages" | "lastActivityAt" | "createdAt"
export type SortOrder = "asc" | "desc"

interface UseAdminUsersQueryOptions {
  page?: number
  limit?: number
  search?: string
  sortField?: SortField
  sortOrder?: SortOrder
}

async function fetchAdminUsers(
  options: UseAdminUsersQueryOptions
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams()
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())
  if (options.search) params.set("search", options.search)
  if (options.sortField) params.set("sortField", options.sortField)
  if (options.sortOrder) params.set("sortOrder", options.sortOrder)

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
    queryKey: queryKeys.admin.users(page, options.search, options.sortField, options.sortOrder),
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

// Mutation for updating user properties (admin status, subscription plan)
interface UpdateUserParams {
  userId: string
  isAdmin?: boolean
  plan?: Plan
}

async function updateUser({ userId, isAdmin, plan }: UpdateUserParams): Promise<User> {
  const body: { isAdmin?: boolean; plan?: Plan } = {}
  if (typeof isAdmin === "boolean") body.isAdmin = isAdmin
  if (plan !== undefined) body.plan = plan

  const response = await fetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
