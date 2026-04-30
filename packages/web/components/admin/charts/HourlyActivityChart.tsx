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
      <div className="flex h-[200px] items-center justify-center text-muted-foreground">
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

  // Color intensity based on activity level
  const getColor = (count: number) => {
    if (count === 0) return "hsl(var(--muted))"
    const intensity = count / maxCount
    // Gradient from light purple to dark purple
    const lightness = 70 - intensity * 40
    return `hsl(250, 60%, ${lightness}%)`
  }

  const formatHour = (hour: number) => {
    if (hour === 0) return "12a"
    if (hour === 12) return "12p"
    if (hour < 12) return `${hour}a`
    return `${hour - 12}p`
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={fullData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 10 }}
            className="text-muted-foreground"
            tickFormatter={formatHour}
            interval={2}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            labelFormatter={(hour) => {
              const h = hour as number
              if (h === 0) return "12:00 AM - 1:00 AM"
              if (h === 12) return "12:00 PM - 1:00 PM"
              if (h < 12) return `${h}:00 AM - ${h + 1}:00 AM`
              return `${h - 12}:00 PM - ${h - 11}:00 PM`
            }}
            formatter={(value) => [value, "Messages"]}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {fullData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.count)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
