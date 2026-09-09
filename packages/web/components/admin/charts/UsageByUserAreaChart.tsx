"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import {
  CATEGORICAL_COLORS,
  formatAxisDate,
  formatMetricValue,
  formatTooltipDate,
} from "./chartFormatters"

interface UserLabel {
  userId: string
  name: string
  image: string | null
}

/**
 * Custom tooltip content: the default renderer has no per-item color swatch
 * (it only recolors the text), and lists every series even at $0 — with
 * dozens of users stacked, most days most of them are zero. This drops the
 * zeros and adds a swatch so the ones left are easy to match to the chart.
 */
function UserAreaTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const visible = [...payload]
    .filter((entry) => Number(entry.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
  if (visible.length === 0) return null

  return (
    <div style={chartTooltipProps.contentStyle}>
      <p style={chartTooltipProps.labelStyle}>{formatTooltipDate(label as string)}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {visible.map((entry) => (
          <li
            key={String(entry.dataKey)}
            style={{
              ...chartTooltipProps.itemStyle,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: entry.color,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{entry.name}</span>
            <span style={{ fontWeight: 600 }}>{formatMetricValue("cost", Number(entry.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface UsageByUserAreaChartProps {
  /** One row per day, one column per userId — see the usage-distribution
   * route's `byUser.cost`, already merged across whichever providers are
   * selected on the Leaderboard. */
  data: Array<Record<string, number | string>>
  /** Name/image lookup for the ids appearing in `data`. */
  users: UserLabel[]
  /** Which users to plot. `null` means "everyone with usage in range" — the
   * default, before anyone has touched a checkbox in the table below. */
  selectedUserIds: Set<string> | null
}

/**
 * List value over time, stacked by user.
 *
 * Sits above the Usage by user table and reads the *same* checkboxes: this
 * is the table's own selection rendered as a chart, not an independent view.
 */
export function UsageByUserAreaChart({ data, users, selectedUserIds }: UsageByUserAreaChartProps) {
  const fmt = (v: number) => formatMetricValue("cost", v)
  const nameById = new Map(users.map((u) => [u.userId, u.name]))

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
              tickFormatter={formatAxisDate}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={50}
              tickFormatter={(v) => fmt(Number(v))}
            />
            <Tooltip content={UserAreaTooltip} cursor={lineTooltipCursor} isAnimationActive={false} />
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
