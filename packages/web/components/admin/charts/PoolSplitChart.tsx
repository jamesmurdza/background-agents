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
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import { formatAxisDate, formatHour, formatMetricValue, formatTooltipDate } from "./chartFormatters"
import type { PoolSplitPoint, UsageMetric } from "@/lib/query/hooks"

// Shared is our spend, so it takes the primary colour; own-key is muted since it
// costs the platform nothing.
const SHARED_COLOR = "hsl(262, 83%, 58%)"
const USER_COLOR = "hsl(152, 60%, 50%)"

interface PoolSplitChartProps {
  data: PoolSplitPoint[]
  metric: UsageMetric
  /** True when `data` is bucketed by hour-of-day (the 24h range) rather than by day. */
  isHourly?: boolean
}

/**
 * Shared-pool vs own-key usage over time.
 *
 * Deliberately ignores the dashboard's global pool filter — this chart *is* the
 * pool breakdown, and its job is showing how much of total demand lands on
 * credentials we pay for.
 */
export function PoolSplitChart({ data, metric, isHourly = false }: PoolSplitChartProps) {
  const fmt = (v: number) => formatMetricValue(metric, v)
  const sharedTotal = data.reduce((acc, d) => acc + d.shared, 0)
  const userTotal = data.reduce((acc, d) => acc + d.user, 0)
  const total = sharedTotal + userTotal

  if (total <= 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No usage recorded in this range
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
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
              tickFormatter={(value) => fmt(Number(value))}
            />
            <Tooltip
              {...chartTooltipProps}
              cursor={lineTooltipCursor}
              labelFormatter={(label) => (isHourly ? formatHour(Number(label)) : formatTooltipDate(label))}
              formatter={(value) => fmt(Number(value))}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} itemSorter={null} />
            <Area
              type="monotone"
              dataKey="shared"
              name="Our pool"
              stackId="1"
              stroke={SHARED_COLOR}
              fill={SHARED_COLOR}
              fillOpacity={0.6}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="user"
              name="Own key"
              stackId="1"
              stroke={USER_COLOR}
              fill={USER_COLOR}
              fillOpacity={0.6}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmt(sharedTotal)}</span> on our pool
        ({((sharedTotal / total) * 100).toFixed(0)}%),{" "}
        <span className="font-medium text-foreground">{fmt(userTotal)}</span> on users&apos;
        own keys.
      </p>
    </div>
  )
}
