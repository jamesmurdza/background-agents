"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Search, ChevronLeft, ChevronRight, Shield, ShieldOff, ArrowUp, ArrowDown, ArrowUpDown, Crown, Mail, Github } from "lucide-react"
import { cn } from "@/lib/utils"

interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  githubId: string | null
  isAdmin: boolean
  isPro: boolean
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

export type SortField = "name" | "email" | "totalMessages" | "lastActivityAt" | "createdAt"
export type SortOrder = "asc" | "desc"

interface UserTableProps {
  users: User[]
  pagination: Pagination
  isLoading?: boolean
  searchQuery: string
  sortField: SortField
  sortOrder: SortOrder
  onSearchChange: (query: string) => void
  onPageChange: (page: number) => void
  onSortChange: (field: SortField) => void
  onToggleAdmin: (userId: string, isAdmin: boolean) => void
  onTogglePro: (userId: string, isPro: boolean) => void
  isUpdating?: string | null
  currentUserId?: string
}

function SortHeader({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  align = "left"
}: {
  label: string
  field: SortField
  currentField: SortField
  currentOrder: SortOrder
  onSort: (field: SortField) => void
  align?: "left" | "center"
}) {
  const isActive = currentField === field
  return (
    <th className={`px-4 py-3 font-medium ${align === "center" ? "text-center" : "text-left"}`}>
      <button
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {isActive ? (
          currentOrder === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </th>
  )
}

// Mobile card view for users
function MobileUserCard({
  user,
  onToggleAdmin,
  onTogglePro,
  isUpdating,
  currentUserId,
}: {
  user: User
  onToggleAdmin: (userId: string, isAdmin: boolean) => void
  onTogglePro: (userId: string, isPro: boolean) => void
  isUpdating?: string | null
  currentUserId?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* User info row */}
      <div className="flex items-center gap-3">
        {user.image ? (
          <img src={user.image} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {(user.name || user.email || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{user.name || "—"}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {user.email && (
              <a
                href={`mailto:${user.email}`}
                className="text-muted-foreground hover:text-foreground"
                title={user.email}
              >
                <Mail className="h-3.5 w-3.5" />
              </a>
            )}
            {user.githubId && (
              <a
                href={`https://github.com/${user.name || user.githubId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <Github className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{user.totalMessages} messages</span>
        <span>•</span>
        <span>
          {user.lastActivityAt
            ? formatDistanceToNow(new Date(user.lastActivityAt), { addSuffix: true })
            : "Never active"}
        </span>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onTogglePro(user.id, !user.isPro)}
          disabled={isUpdating === user.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            user.isPro
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <Crown className="h-3 w-3" />
          {user.isPro ? "Pro" : "Free"}
        </button>
        <button
          onClick={() => onToggleAdmin(user.id, !user.isAdmin)}
          disabled={isUpdating === user.id || user.id === currentUserId}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            user.isAdmin
              ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
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
      </div>
    </div>
  )
}

export function UserTable({
  users,
  pagination,
  isLoading,
  searchQuery,
  sortField,
  sortOrder,
  onSearchChange,
  onPageChange,
  onSortChange,
  onToggleAdmin,
  onTogglePro,
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

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {isLoading && users.length === 0 ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-3 w-16 rounded bg-muted" />
                </div>
              </div>
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-7 w-16 rounded-full bg-muted" />
                <div className="h-7 w-16 rounded-full bg-muted" />
              </div>
            </div>
          ))
        ) : users.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            No users found
          </div>
        ) : (
          users.map((user) => (
            <MobileUserCard
              key={user.id}
              user={user}
              onToggleAdmin={onToggleAdmin}
              onTogglePro={onTogglePro}
              isUpdating={isUpdating}
              currentUserId={currentUserId}
            />
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <SortHeader label="User" field="name" currentField={sortField} currentOrder={sortOrder} onSort={onSortChange} />
                <th className="px-4 py-3 text-center font-medium">Contact</th>
                <SortHeader label="Messages" field="totalMessages" currentField={sortField} currentOrder={sortOrder} onSort={onSortChange} align="center" />
                <SortHeader label="Last Active" field="lastActivityAt" currentField={sortField} currentOrder={sortOrder} onSort={onSortChange} />
                <SortHeader label="Joined" field="createdAt" currentField={sortField} currentOrder={sortOrder} onSort={onSortChange} />
                <th className="px-4 py-3 text-center font-medium">Pro</th>
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
                      <div className="h-4 w-24 rounded bg-muted animate-pulse" />
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
                    <td className="px-4 py-3 text-center">
                      <div className="mx-auto h-6 w-12 rounded bg-muted animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {user.email && (
                          <a
                            href={`mailto:${user.email}`}
                            className="text-muted-foreground hover:text-foreground"
                            title={user.email}
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        )}
                        {user.githubId && (
                          <a
                            href={`https://github.com/${user.name || user.githubId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title={`GitHub: ${user.name || user.githubId}`}
                          >
                            <Github className="h-4 w-4" />
                          </a>
                        )}
                        {!user.email && !user.githubId && "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{user.totalMessages}</td>
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
                        onClick={() => onTogglePro(user.id, !user.isPro)}
                        disabled={isUpdating === user.id}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                          user.isPro
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                        title={user.isPro ? "Click to remove Pro status" : "Click to grant Pro status"}
                      >
                        <Crown className="h-3 w-3" />
                        {user.isPro ? "Pro" : "Free"}
                      </button>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total} users
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1 || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Previous</span>
            </button>
            <span className="text-sm text-muted-foreground">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
