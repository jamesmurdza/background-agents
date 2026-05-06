"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Users,
  MessageSquare,
  Activity,
  TrendingUp,
  Clock,
  Trophy,
  LayoutDashboard,
  Menu,
  X,
  ArrowLeft,
} from "lucide-react"
import { ActivityFeed } from "@/components/admin/ActivityFeed"
import { UserTable, type SortField, type SortOrder } from "@/components/admin/UserTable"
import { UserGrowthChart } from "@/components/admin/charts/UserGrowthChart"
import { MessagesByModelChart } from "@/components/admin/charts/MessagesByModelChart"
import { TopUsersTable } from "@/components/admin/TopUsersTable"
import { HourlyActivityChart } from "@/components/admin/charts/HourlyActivityChart"
import { DailyMessagesChatsChart } from "@/components/admin/charts/DailyMessagesChatsChart"
import {
  useAdminStatsQuery,
  useAdminActivityQuery,
  useAdminUsersQuery,
  useUpdateUserMutation,
  useAdminTopUsersQuery,
  type TopUsersRange,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

type SectionKey = "overview" | "users" | "activity"

const sections: { key: SectionKey; label: string; icon: typeof Users }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: Users },
  { key: "activity", label: "Activity", icon: Activity },
]

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Navigation state
  const [activeSection, setActiveSection] = useState<SectionKey>("overview")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // User table state
  const [usersPage, setUsersPage] = useState(1)
  const [usersSearch, setUsersSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("createdAt")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")

  // Activity state
  const [activityPage, setActivityPage] = useState(1)
  const [activityFilters, setActivityFilters] = useState<{
    action?: string
    agent?: string
    model?: string
    dateFrom?: string
    dateTo?: string
  }>({})

  // Top users time range state
  const [topUsersRange, setTopUsersRange] = useState<TopUsersRange>("24h")

  // Queries
  const statsQuery = useAdminStatsQuery()
  const topUsersQuery = useAdminTopUsersQuery(topUsersRange)
  const activityQuery = useAdminActivityQuery({
    page: activityPage,
    limit: 20,
    ...activityFilters,
    includeFilters: true,
  })
  const usersQuery = useAdminUsersQuery({
    page: usersPage,
    search: usersSearch || undefined,
    sortField,
    sortOrder,
  })
  const updateUserMutation = useUpdateUserMutation()

  // Handle sort change
  const handleSortChange = (field: SortField) => {
    if (field === sortField) {
      // Toggle order if clicking same field
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      // New field, default to desc
      setSortField(field)
      setSortOrder("desc")
    }
    setUsersPage(1) // Reset to first page on sort change
  }

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

  const weeklyActiveUsers = statsQuery.data?.weeklyActiveUsers ?? []
  const topUsers = topUsersQuery.data?.topUsers ?? []
  const hourlyActivity = statsQuery.data?.hourlyActivity ?? []
  const dailyMessagesChats = statsQuery.data?.dailyMessagesChats ?? []
  const messagesByAgent7d = statsQuery.data?.messagesByAgent7d ?? []
  const messagesByModel7d = statsQuery.data?.messagesByModel7d ?? []
  const messagesByAgent30d = statsQuery.data?.messagesByAgent30d ?? []
  const messagesByModel30d = statsQuery.data?.messagesByModel30d ?? []

  // Handle section change with mobile menu close
  const handleSectionChange = (section: SectionKey) => {
    setActiveSection(section)
    setMobileMenuOpen(false)
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold">Admin</h1>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop: always visible, Mobile: slide-in menu */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r bg-card transition-transform duration-200 md:static md:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="sticky top-0 p-4">
          {/* Desktop title */}
          <h1 className="mb-6 text-lg font-semibold hidden md:block">Admin</h1>
          {/* Mobile: add top padding for header */}
          <div className="h-14 md:hidden" />
          <nav className="space-y-1">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.key
              return (
                <button
                  key={section.key}
                  onClick={() => handleSectionChange(section.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors md:py-2",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              )
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:space-y-8 md:p-8">
          {/* Overview Section */}
          {activeSection === "overview" && (
            <>
              {/* Charts Row 1 */}
              <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <div className="mb-3 flex items-center gap-2 md:mb-4">
                    <MessageSquare className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold md:text-base">Daily Messages & Conversations</h3>
                  </div>
                  <div className="h-[200px] md:h-auto">
                    <DailyMessagesChatsChart data={dailyMessagesChats} />
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <div className="mb-3 flex items-center gap-2 md:mb-4">
                    <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold md:text-base">Messages</h3>
                  </div>
                  <div className="h-[200px] md:h-auto">
                    <MessagesByModelChart
                      agentData7d={messagesByAgent7d}
                      modelData7d={messagesByModel7d}
                      agentData30d={messagesByAgent30d}
                      modelData30d={messagesByModel30d}
                    />
                  </div>
                </div>
              </section>

              {/* Charts Row 2 */}
              <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <div className="mb-3 flex items-center gap-2 md:mb-4">
                    <Users className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold md:text-base">Weekly Active Users</h3>
                  </div>
                  <div className="h-[200px] md:h-auto">
                    <UserGrowthChart data={weeklyActiveUsers} />
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <div className="mb-3 flex items-center gap-2 md:mb-4">
                    <Trophy className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold md:text-base">Top Active Users</h3>
                  </div>
                  <TopUsersTable
                    data={topUsers}
                    isLoading={topUsersQuery.isLoading}
                    selectedRange={topUsersRange}
                    onRangeChange={setTopUsersRange}
                  />
                </div>
              </section>

              {/* Charts Row 3 */}
              <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4 md:p-6">
                  <div className="mb-3 flex items-center gap-2 md:mb-4">
                    <Clock className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold md:text-base">Peak Hours (Last 14 Days)</h3>
                  </div>
                  <div className="h-[200px] md:h-auto">
                    <HourlyActivityChart data={hourlyActivity} />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Users Section */}
          {activeSection === "users" && (
            <section>
              <h2 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">User Management</h2>
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
                sortField={sortField}
                sortOrder={sortOrder}
                onSearchChange={(search) => {
                  setUsersSearch(search)
                  setUsersPage(1)
                }}
                onPageChange={setUsersPage}
                onSortChange={handleSortChange}
                onToggleAdmin={(userId, isAdmin) => {
                  updateUserMutation.mutate({ userId, isAdmin })
                }}
                onTogglePro={(userId, isPro) => {
                  updateUserMutation.mutate({ userId, isPro })
                }}
                isUpdating={updateUserMutation.isPending ? updateUserMutation.variables?.userId : null}
                currentUserId={session?.user?.id}
              />
            </section>
          )}

          {/* Activity Section */}
          {activeSection === "activity" && (
            <section>
              <h2 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">Recent Activity</h2>
              <div className="rounded-lg border bg-card p-4 md:p-6">
                <ActivityFeed
                  activities={activityQuery.data?.activities ?? []}
                  filters={activityQuery.data?.filters}
                  filterState={activityFilters}
                  onFilterChange={(filters) => {
                    setActivityFilters(filters)
                    setActivityPage(1)
                  }}
                  isLoading={activityQuery.isLoading}
                  hasMore={
                    activityQuery.data
                      ? activityQuery.data.pagination.page <
                        activityQuery.data.pagination.totalPages
                      : false
                  }
                  onLoadMore={() => setActivityPage((p) => p + 1)}
                />
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
