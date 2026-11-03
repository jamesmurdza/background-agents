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
import { chartTooltipProps, lineTooltipCursor } from "@/components/charts/chartTooltip"
import { timeSeriesGridProps, valueYAxisProps } from "@/components/charts/chartAxes"
import { formatAxisDate, formatTooltipDate } from "@/components/charts/chartFormatters"
import { ChartEmptyState } from "./ChartEmptyState"

interface WeeklyActiveUsersData {
  date: string
  count: number
}

interface UserGrowthChartProps {
  data: WeeklyActiveUsersData[]
}

export function UserGrowthChart({ data }: UserGrowthChartProps) {
  if (!data || data.length === 0) {
    return <ChartEmptyState message="No weekly active users data available" />
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...timeSeriesGridProps} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => formatAxisDate(value)}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
          />
          <YAxis {...valueYAxisProps((value) => String(value))} />
          <Tooltip
            {...chartTooltipProps}
            cursor={lineTooltipCursor}
            formatter={(value) => [value, "Active Users (7-day)"]}
            labelFormatter={(label) => formatTooltipDate(label)}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="hsl(262, 83%, 58%)"
            fill="url(#colorUsers)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
