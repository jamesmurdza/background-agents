"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import { formatAxisDate, formatHour, formatTooltipDate } from "./chartFormatters"
import type { TopupSeriesPoint } from "@/lib/query/hooks"

const LINE_COLOR = "hsl(152, 60%, 50%)"

interface TopUpsOverTimeChartProps {
  data: TopupSeriesPoint[]
  /** True for the 24h range, whose points are hours (0-23) rather than dates. */
  isHourly?: boolean
}

/**
 * Running total of top-up payments (Stripe purchases) over the selected
 * range — an ever-climbing line rather than per-bucket spikes, so it reads as
 * "total raised so far" the way a fundraising or revenue chart would.
 */
export function TopUpsOverTimeChart({ data, isHourly = false }: TopUpsOverTimeChartProps) {
  const total = data.length > 0 ? data[data.length - 1].cumulativeUsd : 0

  if (total <= 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No top-up payments in this range
      </div>
    )
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="colorTopups" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={LINE_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={LINE_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => (isHourly ? formatHour(Number(value)) : formatAxisDate(value))}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            interval={isHourly ? 3 : "preserveStartEnd"}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            width={55}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={lineTooltipCursor}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Total raised"]}
            labelFormatter={(label) => (isHourly ? formatHour(Number(label)) : formatTooltipDate(label))}
          />
          <Area
            type="monotone"
            dataKey="cumulativeUsd"
            stroke={LINE_COLOR}
            fill="url(#colorTopups)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
