"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"

interface AdminStats {
  stats: {
    totalUsers: number
    totalChats: number
    activeChats: number
    chatsCreatedToday: number
    chatsCreatedThisWeek: number
    messagesCreatedToday: number
    messagesCreatedThisWeek: number
    loginsToday: number
    loginsThisWeek: number
  }
  weeklyActiveUsers: Array<{
    date: string
    count: number
  }>
  activityTrends: Array<{
    date: string
    login?: number
    chat_created?: number
    message_sent?: number
    [key: string]: string | number | undefined
  }>
  topUsers: Array<{
    name: string
    image?: string | null
    messageCount: number
    chatCount: number
  }>
  hourlyActivity: Array<{
    hour: number
    count: number
  }>
}

async function fetchAdminStats(): Promise<AdminStats> {
  const response = await fetch("/api/admin/stats")
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Forbidden: Admin access required")
    }
    throw new Error("Failed to fetch admin stats")
  }
  return response.json()
}

export function useAdminStatsQuery() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: fetchAdminStats,
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: (failureCount, error) => {
      // Don't retry on 403 Forbidden
      if (error instanceof Error && error.message.includes("Forbidden")) {
        return false
      }
      return failureCount < 3
    },
  })
}
