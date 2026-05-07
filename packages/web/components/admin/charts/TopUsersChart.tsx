"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

interface TopUserData {
  name: string
  image?: string | null
  messageCount: number
  chatCount: number
}

interface TopUsersChartProps {
  data: TopUserData[]
}

export function TopUsersChart({ data }: TopUsersChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No user activity data available
      </div>
    )
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tick={{ fontSize: 12 }} className="text-muted-foreground" />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            width={95}
            tickFormatter={(value) => value.length > 12 ? value.slice(0, 12) + "..." : value}
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
            cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
            formatter={(value, name) => [
              value,
              name === "messageCount" ? "Messages" : "Conversations",
            ]}
          />
          <Legend />
          <Bar dataKey="messageCount" name="Messages" fill="#8884d8" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="chatCount" name="Conversations" fill="#82ca9d" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
