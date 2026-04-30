"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            formatter={(value, name) => [
              value,
              name === "messageCount" ? "Messages" : "Chats",
            ]}
          />
          <Bar dataKey="messageCount" name="Messages" fill="#8884d8" radius={[0, 4, 4, 0]} />
          <Bar dataKey="chatCount" name="Chats" fill="#82ca9d" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
