"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Search, ChevronLeft, ChevronRight, Shield, ShieldOff } from "lucide-react"

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

interface UserTableProps {
  users: User[]
  pagination: Pagination
  isLoading?: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onPageChange: (page: number) => void
  onToggleAdmin: (userId: string, isAdmin: boolean) => void
  isUpdating?: string | null
  currentUserId?: string
}

export function UserTable({
  users,
  pagination,
  isLoading,
  searchQuery,
  onSearchChange,
  onPageChange,
  onToggleAdmin,
  isUpdating,
  currentUserId,
}: UserTableProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery)

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearchChange(localSearch)
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, email, or GitHub ID..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Search
        </button>
      </form>

      {/* Table */}
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">User</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-center font-medium">Chats</th>
                <th className="px-4 py-3 text-left font-medium">Last Active</th>
                <th className="px-4 py-3 text-left font-medium">Joined</th>
                <th className="px-4 py-3 text-center font-medium">Admin</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && users.length === 0 ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="mx-auto h-4 w-8 rounded bg-muted animate-pulse" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="mx-auto h-6 w-12 rounded bg-muted animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b last:border-b-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.image ? (
                          <img
                            src={user.image}
                            alt=""
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {(user.name || user.email || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium">{user.name || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {user.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">{user.totalChats}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {user.lastActivityAt
                        ? formatDistanceToNow(new Date(user.lastActivityAt), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDistanceToNow(new Date(user.createdAt), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => onToggleAdmin(user.id, !user.isAdmin)}
                        disabled={isUpdating === user.id || user.id === currentUserId}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                          user.isAdmin
                            ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                        title={
                          user.id === currentUserId
                            ? "Cannot modify your own admin status"
                            : user.isAdmin
                              ? "Click to remove admin"
                              : "Click to make admin"
                        }
                      >
                        {user.isAdmin ? (
                          <>
                            <Shield className="h-3 w-3" />
                            Admin
                          </>
                        ) : (
                          <>
                            <ShieldOff className="h-3 w-3" />
                            User
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total} users
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1 || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
