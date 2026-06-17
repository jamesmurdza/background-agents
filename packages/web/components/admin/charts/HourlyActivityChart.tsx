"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { chartTooltipProps, barTooltipCursor } from "./chartTooltip"
import { formatHour, formatMetricValue, metricLabel, type StatsMetric } from "./chartFormatters"

interface HourlyActivityData {
  hour: number
  value: number
}

interface HourlyActivityChartProps {
  data: HourlyActivityData[]
  metric: StatsMetric
}

export function HourlyActivityChart({ data, metric }: HourlyActivityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No hourly activity data available
      </div>
    )
  }

  // Ensure we have all 24 hours, fill with 0 if missing
  const fullData: HourlyActivityData[] = []
  for (let i = 0; i < 24; i++) {
    const existing = data.find((d) => d.hour === i)
    fullData.push(existing || { hour: i, value: 0 })
  }

  const maxCount = Math.max(...fullData.map((d) => d.value))

  // Color intensity based on activity level - using primary color
  const getColor = (count: number) => {
    if (count === 0) return "hsl(var(--muted))"
    const intensity = count / maxCount
    // Gradient from light to saturated purple
    const lightness = 75 - intensity * 30
    const saturation = 40 + intensity * 40
    return `hsl(262, ${saturation}%, ${lightness}%)`
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={fullData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={formatHour}
            interval={2}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            width={50}
            tickFormatter={(value) => formatMetricValue(metric, Number(value))}
          />
          <Tooltip
            {...chartTooltipProps}
            cursor={barTooltipCursor}
            labelFormatter={(hour) => {
              const h = hour as number
              if (h === 0) return "12:00 AM - 1:00 AM"
              if (h === 12) return "12:00 PM - 1:00 PM"
              if (h < 12) return `${h}:00 AM - ${h + 1}:00 AM`
              return `${h - 12}:00 PM - ${h - 11}:00 PM`
            }}
            formatter={(value) => [formatMetricValue(metric, Number(value)), metricLabel(metric)]}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {fullData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.value)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
