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

interface HourlyActivityData {
  hour: number
  count: number
}

interface HourlyActivityChartProps {
  data: HourlyActivityData[]
}

export function HourlyActivityChart({ data }: HourlyActivityChartProps) {
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
    fullData.push(existing || { hour: i, count: 0 })
  }

  const maxCount = Math.max(...fullData.map((d) => d.count))

  // Color intensity based on activity level - using primary color
  const getColor = (count: number) => {
    if (count === 0) return "hsl(var(--muted))"
    const intensity = count / maxCount
    // Gradient from light to saturated purple
    const lightness = 75 - intensity * 30
    const saturation = 40 + intensity * 40
    return `hsl(262, ${saturation}%, ${lightness}%)`
  }

  const formatHour = (hour: number) => {
    if (hour === 0) return "12a"
    if (hour === 12) return "12p"
    if (hour < 12) return `${hour}a`
    return `${hour - 12}p`
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
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))", fontWeight: 500 }}
            itemStyle={{ color: "hsl(var(--popover-foreground))" }}
            labelFormatter={(hour) => {
              const h = hour as number
              if (h === 0) return "12:00 AM - 1:00 AM"
              if (h === 12) return "12:00 PM - 1:00 PM"
              if (h < 12) return `${h}:00 AM - ${h + 1}:00 AM`
              return `${h - 12}:00 PM - ${h - 11}:00 PM`
            }}
            formatter={(value) => [value, "Messages"]}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {fullData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.count)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
