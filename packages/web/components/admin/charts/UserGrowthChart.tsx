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

interface WeeklyActiveUsersData {
  date: string
  count: number
}

interface UserGrowthChartProps {
  data: WeeklyActiveUsersData[]
}

export function UserGrowthChart({ data }: UserGrowthChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No weekly active users data available
      </div>
    )
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
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => {
              const date = new Date(value)
              return `${date.getMonth() + 1}/${date.getDate()}`
            }}
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
              backgroundColor: "var(--tooltip-bg, #fff)",
              border: "1px solid var(--tooltip-border, #e5e7eb)",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              padding: "8px 12px",
            }}
            labelStyle={{ color: "var(--tooltip-text, #111)", fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: "var(--tooltip-text, #111)", padding: "2px 0" }}
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "4 4" }}
            formatter={(value) => [value, "Active Users (7-day)"]}
            labelFormatter={(label) => {
              const date = new Date(label)
              return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
            }}
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
