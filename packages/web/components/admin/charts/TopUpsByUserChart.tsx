"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { chartTooltipProps, barTooltipCursor } from "./chartTooltip"
import type { TopupUser } from "@/lib/query/hooks"

const BAR_COLOR = "hsl(152, 60%, 50%)"
// Longest tick label before it's clipped, so the axis doesn't eat the plot area.
const MAX_LABEL_LENGTH = 14

interface TopUpsByUserChartProps {
  data: TopupUser[]
}

function truncate(name: string): string {
  return name.length > MAX_LABEL_LENGTH ? `${name.slice(0, MAX_LABEL_LENGTH - 1)}…` : name
}

/**
 * Top-up payments (Stripe purchases) ranked by user for the selected range.
 * Horizontal bars so names stay legible without rotating axis labels.
 */
export function TopUpsByUserChart({ data }: TopUpsByUserChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No top-up payments in this range
      </div>
    )
  }

  // Recharts renders top-to-bottom in array order; reverse so the biggest
  // spender lands at the top of the chart, matching a typical leaderboard.
  const chartData = [...data].reverse()
  const height = Math.max(200, chartData.length * 36)

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 24, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tickFormatter={truncate}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            width={100}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={barTooltipCursor}
            formatter={(value, _name, entry) => {
              const count = (entry?.payload as TopupUser | undefined)?.count ?? 0
              return [`$${Number(value).toFixed(2)}`, `${count} payment${count === 1 ? "" : "s"}`]
            }}
          />
          <Bar dataKey="totalUsd" fill={BAR_COLOR} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
