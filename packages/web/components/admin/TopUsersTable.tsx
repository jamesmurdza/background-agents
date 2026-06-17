"use client"

import { formatMetricValue, metricLabel, type StatsMetric } from "./charts/chartFormatters"

interface TopUserData {
  name: string
  image?: string | null
  primary: number
  secondary: number | null
}

interface TopUsersTableProps {
  data: TopUserData[]
  metric: StatsMetric
  isLoading?: boolean
}

export function TopUsersTable({ data, metric, isLoading }: TopUsersTableProps) {
  // Conversations column only applies to the "messages" metric.
  const showSecondary = metric === "messages"
  const primaryHeader = metricLabel(metric)

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-2 py-2 text-left font-medium sm:px-4 sm:py-3">User</th>
              <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">{primaryHeader}</th>
              {showSecondary && (
                <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                  <span className="sm:hidden">Chats</span>
                  <span className="hidden sm:inline">Conversations</span>
                </th>
              )}
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
                {showSecondary && (
                  <td className="px-2 py-2 text-right sm:px-4 sm:py-3">
                    <div className="ml-auto h-4 w-8 sm:w-12 rounded bg-muted animate-pulse" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        No user activity data available
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-2 py-2 text-left font-medium sm:px-4 sm:py-3">User</th>
            <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">{primaryHeader}</th>
            {showSecondary && (
              <th className="px-2 py-2 text-right font-medium sm:px-4 sm:py-3">
                <span className="sm:hidden">Chats</span>
                <span className="hidden sm:inline">Conversations</span>
              </th>
            )}
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
              <td className="px-2 py-2 text-right tabular-nums text-xs sm:text-sm sm:px-4 sm:py-3">
                {formatMetricValue(metric, user.primary)}
              </td>
              {showSecondary && (
                <td className="px-2 py-2 text-right tabular-nums text-xs sm:text-sm sm:px-4 sm:py-3">
                  {(user.secondary ?? 0).toLocaleString()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
