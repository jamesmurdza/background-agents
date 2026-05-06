"use client"

import type { TopUsersRange } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

interface TopUserData {
  name: string
  image?: string | null
  messageCount: number
  chatCount: number
}

interface TopUsersTableProps {
  data: TopUserData[]
  isLoading?: boolean
  selectedRange: TopUsersRange
  onRangeChange: (range: TopUsersRange) => void
}

const rangeOptions: { value: TopUsersRange; label: string; shortLabel: string }[] = [
  { value: "24h", label: "Last 24 Hours", shortLabel: "24h" },
  { value: "7d", label: "Last 7 Days", shortLabel: "7d" },
  { value: "30d", label: "Last 30 Days", shortLabel: "30d" },
]

export function TopUsersTable({ data, isLoading, selectedRange, onRangeChange }: TopUsersTableProps) {
  return (
    <div className="space-y-4">
      {/* Time Range Selector */}
      <div className="flex gap-1 sm:gap-2">
        {rangeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onRangeChange(option.value)}
            className={cn(
              "rounded-md px-2 py-1.5 text-xs sm:px-3 sm:text-sm font-medium transition-colors",
              selectedRange === option.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            <span className="sm:hidden">{option.shortLabel}</span>
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-2 py-2 text-left font-medium sm:px-4 sm:py-3">User</th>
                <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                  <span className="sm:hidden">Msgs</span>
                  <span className="hidden sm:inline">Messages</span>
                </th>
                <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                  <span className="sm:hidden">Chats</span>
                  <span className="hidden sm:inline">Conversations</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="px-2 py-2 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="h-6 w-6 sm:h-8 sm:w-8 rounded-full bg-muted animate-pulse" />
                      <div className="h-4 w-16 sm:w-24 rounded bg-muted animate-pulse" />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right sm:px-4 sm:py-3">
                    <div className="ml-auto h-4 w-8 sm:w-12 rounded bg-muted animate-pulse" />
                  </td>
                  <td className="px-2 py-2 text-right sm:px-4 sm:py-3">
                    <div className="ml-auto h-4 w-8 sm:w-12 rounded bg-muted animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
          No user activity data available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-2 py-2 text-left font-medium sm:px-4 sm:py-3">User</th>
                <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                  <span className="sm:hidden">Msgs</span>
                  <span className="hidden sm:inline">Messages</span>
                </th>
                <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                  <span className="sm:hidden">Chats</span>
                  <span className="hidden sm:inline">Conversations</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((user, index) => (
                <tr key={index} className="border-b last:border-b-0 hover:bg-muted/50">
                  <td className="px-2 py-2 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      {user.image ? (
                        <img
                          src={user.image}
                          alt=""
                          className="h-6 w-6 sm:h-8 sm:w-8 rounded-full"
                        />
                      ) : (
                        <div className="flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {user.name[0]?.toUpperCase() || "?"}
                        </div>
                      )}
                      <span className="font-medium text-xs sm:text-sm truncate max-w-[80px] sm:max-w-none">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs sm:text-sm sm:px-4 sm:py-3">{user.messageCount.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs sm:text-sm sm:px-4 sm:py-3">{user.chatCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
