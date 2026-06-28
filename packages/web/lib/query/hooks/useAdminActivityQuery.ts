"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"

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

interface ActivityFilters {
  actions: string[]
  agents: string[]
  models: string[]
}

interface AdminActivityResponse {
  activities: Activity[]
  pagination: Pagination
  filters?: ActivityFilters
}

interface UseAdminActivityQueryOptions {
  page?: number
  limit?: number
  action?: string
  userId?: string
  agent?: string
  model?: string
  dateFrom?: string
  dateTo?: string
  includeFilters?: boolean
}

async function fetchAdminActivity(
  options: UseAdminActivityQueryOptions
): Promise<AdminActivityResponse> {
  const params = new URLSearchParams()
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())
  if (options.action) params.set("action", options.action)
  if (options.userId) params.set("userId", options.userId)
  if (options.agent) params.set("agent", options.agent)
  if (options.model) params.set("model", options.model)
  if (options.dateFrom) params.set("dateFrom", options.dateFrom)
  if (options.dateTo) params.set("dateTo", options.dateTo)
  if (options.includeFilters) params.set("includeFilters", "true")

  return fetchAdminJson<AdminActivityResponse>(`/api/admin/activity?${params}`, "activity")
}

export function useAdminActivityQuery(options: UseAdminActivityQueryOptions = {}) {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"
  const page = options.page ?? 1

  return useQuery({
    queryKey: queryKeys.admin.activity(page, {
      action: options.action,
      userId: options.userId,
      agent: options.agent,
      model: options.model,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    }),
    queryFn: () => fetchAdminActivity(options),
    enabled: isAuthenticated,
    staleTime: 15 * 1000, // 15 seconds
    retry: adminRetry,
  })
}
