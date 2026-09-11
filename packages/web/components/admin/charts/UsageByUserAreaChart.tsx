"use client"

import { useEffect } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { lineTooltipCursor, SingleAreaTooltipContent, useSingleAreaHover } from "./chartTooltip"
import {
  CATEGORICAL_COLORS,
  formatAxisDate,
  formatHour,
  formatMetricValue,
  formatTooltipDate,
} from "./chartFormatters"

interface UserLabel {
  userId: string
  name: string
  image: string | null
}

interface UsageByUserAreaChartProps {
  /** One row per day (or per hour for the 24h range), one column per userId —
   * see the usage-distribution route's `byUser.cost`, already merged across
   * whichever providers are selected on the Leaderboard. */
  data: Array<Record<string, number | string>>
  /** Name/image lookup for the ids appearing in `data`. */
  users: UserLabel[]
  /** Which users to plot. `null` means "everyone with usage in range" — the
   * default, before anyone has touched a checkbox in the table below. */
  selectedUserIds: Set<string> | null
  /** True when `data` is bucketed by hour-of-day (the 24h range) rather than by day. */
  isHourly?: boolean
}

/**
 * List value over time, stacked by user.
 *
 * Sits above the Usage by user table and reads the *same* checkboxes: this
 * is the table's own selection rendered as a chart, not an independent view.
 */
export function UsageByUserAreaChart({
  data,
  users,
  selectedUserIds,
  isHourly = false,
}: UsageByUserAreaChartProps) {
  const fmt = (v: number) => formatMetricValue("cost", v)
  const nameById = new Map(users.map((u) => [u.userId, u.name]))
  const { hoveredKey, getHoverHandlers, reset: resetHover } = useSingleAreaHover()

  // The id set a chart can plot is whatever actually shows up in the data —
  // independent of `users`, which exists only to label them.
  const allIds = new Set<string>()
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (key !== "time") allIds.add(key)
    }
  }

  const totals: Record<string, number> = {}
  for (const row of data) {
    for (const id of allIds) {
      totals[id] = (totals[id] || 0) + Number(row[id] || 0)
    }
  }
  const grandTotal = Object.values(totals).reduce((acc, v) => acc + v, 0)

  const ordered = [...allIds].sort((a, b) => (totals[b] || 0) - (totals[a] || 0))
  const plotted = selectedUserIds === null ? ordered : ordered.filter((id) => selectedUserIds.has(id))

  // A hovered user who gets unchecked (or a refetch replacing `data`) would
  // otherwise leave a stale, un-rendered Area "hovered" with no way to clear it.
  useEffect(() => {
    resetHover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedUserIds])

  if (grandTotal === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center px-6 text-center text-muted-foreground text-sm">
        No usage recorded for the selected provider(s) in this range.
      </div>
    )
  }

  if (plotted.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center px-6 text-center text-muted-foreground text-sm">
        No users selected — check at least one row in the table below to plot it here.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) =>
                isHourly ? formatHour(Number(value)) : formatAxisDate(value)
              }
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              interval={isHourly ? 3 : "preserveStartEnd"}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={50}
              tickFormatter={(v) => fmt(Number(v))}
            />
            {/* Only shows a tooltip for the specific user's band the mouse is
                over (see useSingleAreaHover) — AreaChart has no built-in
                per-item hover mode, so `active`/`content` fake one. */}
            <Tooltip
              active={hoveredKey !== null}
              cursor={hoveredKey !== null ? lineTooltipCursor : false}
              content={(props) => (
                <SingleAreaTooltipContent
                  {...props}
                  hoveredKey={hoveredKey}
                  formatValue={fmt}
                  formatLabel={(label) =>
                    isHourly ? formatHour(Number(label)) : formatTooltipDate(label)
                  }
                />
              )}
              isAnimationActive={false}
            />
            {/* Each Area's `name` below is already the resolved display name,
                so Tooltip/Legend need no id→name lookup of their own. Legend
                hidden past 12 series — it would just overflow. */}
            {plotted.length <= 12 && (
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} itemSorter={null} />
            )}
            {plotted.map((id, index) => {
              const color = CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]
              return (
                <Area
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={nameById.get(id) ?? id}
                  stackId="1"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.6}
                  isAnimationActive={false}
                  {...getHoverHandlers(id)}
                />
              )
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        {fmt(grandTotal)} total across {ordered.length} user{ordered.length === 1 ? "" : "s"} with
        usage in range, {plotted.length} plotted.
        {plotted.length > 12 && " Legend hidden past 12 series — narrow the selection below to see it."}
      </p>
    </div>
  )
}
