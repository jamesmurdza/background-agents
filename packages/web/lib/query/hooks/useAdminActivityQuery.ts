"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"

interface Activity {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface AdminActivityResponse {
  activities: Activity[]
  pagination: Pagination
}

interface UseAdminActivityQueryOptions {
  page?: number
  limit?: number
  action?: string
  userId?: string
}

async function fetchAdminActivity(
  options: UseAdminActivityQueryOptions
): Promise<AdminActivityResponse> {
  const params = new URLSearchParams()
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())
  if (options.action) params.set("action", options.action)
  if (options.userId) params.set("userId", options.userId)

  const response = await fetch(`/api/admin/activity?${params}`)
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Forbidden: Admin access required")
    }
    throw new Error("Failed to fetch admin activity")
  }
  return response.json()
}

export function useAdminActivityQuery(options: UseAdminActivityQueryOptions = {}) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"
  const page = options.page ?? 1

  return useQuery({
    queryKey: queryKeys.admin.activity(page, {
      action: options.action,
      userId: options.userId,
    }),
    queryFn: () => fetchAdminActivity(options),
    enabled: isAuthenticated,
    staleTime: 15 * 1000, // 15 seconds
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("Forbidden")) {
        return false
      }
      return failureCount < 3
    },
  })
}
