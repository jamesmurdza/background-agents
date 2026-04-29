"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Users,
  MessageSquare,
  FolderOpen,
  LogIn,
  ArrowLeft,
  BarChart3,
  Activity,
  TrendingUp,
} from "lucide-react"

import { StatCard } from "@/components/admin/StatCard"
import { ActivityFeed } from "@/components/admin/ActivityFeed"
import { UserTable } from "@/components/admin/UserTable"
import { ActivityChart } from "@/components/admin/charts/ActivityChart"
import { ModelUsageChart } from "@/components/admin/charts/ModelUsageChart"
import { UserGrowthChart } from "@/components/admin/charts/UserGrowthChart"
import {
  useAdminStatsQuery,
  useAdminActivityQuery,
  useAdminUsersQuery,
  useUpdateUserMutation,
} from "@/lib/query/hooks"

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // User table state
  const [usersPage, setUsersPage] = useState(1)
  const [usersSearch, setUsersSearch] = useState("")

  // Activity state
  const [activityPage, setActivityPage] = useState(1)

  // Queries
  const statsQuery = useAdminStatsQuery()
  const activityQuery = useAdminActivityQuery({ page: activityPage, limit: 20 })
  const usersQuery = useAdminUsersQuery({ page: usersPage, search: usersSearch || undefined })
  const updateUserMutation = useUpdateUserMutation()

  // Redirect if not authenticated or forbidden
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
    }
  }, [status, router])

  // Handle 403 errors by redirecting
  useEffect(() => {
    const isForbidden =
      statsQuery.error?.message?.includes("Forbidden") ||
      activityQuery.error?.message?.includes("Forbidden") ||
      usersQuery.error?.message?.includes("Forbidden")

    if (isForbidden) {
      router.push("/")
    }
  }, [statsQuery.error, activityQuery.error, usersQuery.error, router])

  // Loading state
  if (status === "loading" || statsQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Not authenticated
  if (status === "unauthenticated") {
    return null
  }

  const stats = statsQuery.data?.stats
  const modelUsage = statsQuery.data?.modelUsage ?? []
  const userGrowth = statsQuery.data?.userGrowth ?? []
  const activityTrends = statsQuery.data?.activityTrends ?? []

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h1 className="text-xl font-semibold">Admin Dashboard</h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {/* Stats Grid */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">Overview</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Users}
              label="Total Users"
              value={stats?.totalUsers ?? 0}
            />
            <StatCard
              icon={FolderOpen}
              label="Total Chats"
              value={stats?.totalChats ?? 0}
              subValue={`${stats?.chatsCreatedToday ?? 0} today`}
            />
            <StatCard
              icon={MessageSquare}
              label="Messages This Week"
              value={stats?.messagesCreatedThisWeek ?? 0}
              subValue={`${stats?.messagesCreatedToday ?? 0} today`}
            />
            <StatCard
              icon={LogIn}
              label="Logins This Week"
              value={stats?.loginsThisWeek ?? 0}
              subValue={`${stats?.loginsToday ?? 0} today`}
            />
          </div>
        </section>

        {/* Charts */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Activity Over Time</h3>
            </div>
            <ActivityChart data={activityTrends} />
          </div>

          <div className="rounded-lg border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Model Usage</h3>
            </div>
            <ModelUsageChart data={modelUsage} />
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">User Growth (Last 30 Days)</h3>
          </div>
          <UserGrowthChart data={userGrowth} />
        </section>

        {/* Recent Activity */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
          <ActivityFeed
            activities={activityQuery.data?.activities ?? []}
            isLoading={activityQuery.isLoading}
            hasMore={
              activityQuery.data
                ? activityQuery.data.pagination.page <
                  activityQuery.data.pagination.totalPages
                : false
            }
            onLoadMore={() => setActivityPage((p) => p + 1)}
          />
        </section>

        {/* User Management */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">User Management</h2>
          <UserTable
            users={usersQuery.data?.users ?? []}
            pagination={
              usersQuery.data?.pagination ?? {
                page: 1,
                limit: 20,
                total: 0,
                totalPages: 0,
              }
            }
            isLoading={usersQuery.isLoading}
            searchQuery={usersSearch}
            onSearchChange={(search) => {
              setUsersSearch(search)
              setUsersPage(1)
            }}
            onPageChange={setUsersPage}
            onToggleAdmin={(userId, isAdmin) => {
              updateUserMutation.mutate({ userId, isAdmin })
            }}
            isUpdating={updateUserMutation.isPending ? updateUserMutation.variables?.userId : null}
            currentUserId={session?.user?.id}
          />
        </section>
      </main>
    </div>
  )
}
