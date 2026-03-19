"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Search, ChevronLeft, ChevronRight, Loader2, Save, ArrowLeft, Shield, Users, Box, Zap, Activity } from "lucide-react"
import Link from "next/link"

interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  githubLogin: string | null
  isAdmin: boolean
  maxSandboxes: number | null
  activeSandboxes: number
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface Stats {
  totalUsers: number
  activeSandboxes: number
  sandboxesCreatedToday: number
  sandboxesCreatedThisWeek: number
  agentExecutionsToday: number
  agentExecutionsThisWeek: number
}

interface ActivityEntry {
  id: string
  userId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

const DEFAULT_MAX_SANDBOXES = 10

function StatCard({ icon: Icon, label, value, subValue }: { icon: React.ElementType; label: string; value: number; subValue?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
        </div>
      </div>
    </div>
  )
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function getActionLabel(action: string): string {
  switch (action) {
    case "sandbox_created": return "Created sandbox"
    case "sandbox_deleted": return "Deleted sandbox"
    case "agent_executed": return "Ran agent"
    default: return action
  }
}

export default function AdminPage() {
  const { status } = useSession()
  const router = useRouter()

  const [stats, setStats] = useState<Stats | null>(null)
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>("")
  const [saving, setSaving] = useState(false)

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch("/api/admin/stats")
      if (res.status === 403) {
        router.push("/")
        return
      }
      if (!res.ok) throw new Error("Failed to fetch stats")
      const data = await res.json()
      setStats(data.stats)
      setRecentActivity(data.recentActivity || [])
    } catch (err) {
      console.error("Failed to fetch stats:", err)
    } finally {
      setStatsLoading(false)
    }
  }, [router])

  const fetchUsers = useCallback(async (page: number, searchQuery: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      })
      if (searchQuery) {
        params.set("search", searchQuery)
      }
      const res = await fetch(`/api/admin/users?${params}`)
      if (res.status === 403) {
        router.push("/")
        return
      }
      if (!res.ok) {
        throw new Error("Failed to fetch users")
      }
      const data = await res.json()
      setUsers(data.users)
      setPagination(data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
      return
    }
    if (status === "authenticated") {
      fetchStats()
      fetchUsers(pagination.page, search)
    }
  }, [status, router]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchUsers(1, search)
  }

  const handlePageChange = (newPage: number) => {
    fetchUsers(newPage, search)
  }

  const handleEditStart = (user: User) => {
    setEditingUserId(user.id)
    setEditValue(user.maxSandboxes?.toString() ?? "")
  }

  const handleEditCancel = () => {
    setEditingUserId(null)
    setEditValue("")
  }

  const handleSave = async (userId: string) => {
    setSaving(true)
    try {
      const maxSandboxes = editValue === "" ? null : parseInt(editValue, 10)
      if (maxSandboxes !== null && (isNaN(maxSandboxes) || maxSandboxes < 1 || maxSandboxes > 100)) {
        setError("Limit must be between 1 and 100, or empty for default")
        setSaving(false)
        return
      }

      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSandboxes }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update user")
      }

      // Update local state
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, maxSandboxes } : u))
      )
      setEditingUserId(null)
      setEditValue("")
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setSaving(false)
    }
  }

  if (status === "loading") {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Admin</h1>
                <p className="text-sm text-muted-foreground">Platform metrics and user management</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {statsLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-secondary" />
                    <div className="space-y-2">
                      <div className="h-6 w-12 rounded bg-secondary" />
                      <div className="h-3 w-20 rounded bg-secondary" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : stats ? (
            <>
              <StatCard icon={Users} label="Total Users" value={stats.totalUsers} />
              <StatCard icon={Box} label="Active Sandboxes" value={stats.activeSandboxes} />
              <StatCard
                icon={Box}
                label="Sandboxes Created"
                value={stats.sandboxesCreatedToday}
                subValue={`${stats.sandboxesCreatedThisWeek} this week`}
              />
              <StatCard
                icon={Zap}
                label="Agent Runs Today"
                value={stats.agentExecutionsToday}
                subValue={`${stats.agentExecutionsThisWeek} this week`}
              />
            </>
          ) : null}
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <Activity className="h-4 w-4" />
              Recent Activity
            </h2>
            <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-48 overflow-y-auto">
              {recentActivity.slice(0, 10).map((entry) => (
                <div key={entry.id} className="px-4 py-2 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formatTimeAgo(entry.createdAt)}</span>
                    <span className="text-foreground">{getActionLabel(entry.action)}</span>
                    {entry.metadata && (
                      <span className="text-muted-foreground">
                        {(entry.metadata as Record<string, string>).repoOwner}/{(entry.metadata as Record<string, string>).repoName}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, email, or GitHub username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  GitHub
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Usage
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Limit
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.image ? (
                          <img
                            src={user.image}
                            alt=""
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-secondary" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {user.name || "—"}
                          </div>
                          {user.isAdmin && (
                            <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {user.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {user.githubLogin ? (
                        <a
                          href={`https://github.com/${user.githubLogin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground transition-colors"
                        >
                          @{user.githubLogin}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      <span
                        className={
                          user.activeSandboxes >= (user.maxSandboxes ?? DEFAULT_MAX_SANDBOXES)
                            ? "text-destructive font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {user.activeSandboxes}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingUserId === user.id ? (
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder={DEFAULT_MAX_SANDBOXES.toString()}
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(user.id)
                            if (e.key === "Escape") handleEditCancel()
                          }}
                        />
                      ) : (
                        <span className="text-sm text-foreground">
                          {user.maxSandboxes ?? (
                            <span className="text-muted-foreground">{DEFAULT_MAX_SANDBOXES}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingUserId === user.id ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleSave(user.id)}
                            disabled={saving}
                            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {saving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="h-3 w-3" />
                            )}
                            Save
                          </button>
                          <button
                            onClick={handleEditCancel}
                            disabled={saving}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditStart(user)}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total} users
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
