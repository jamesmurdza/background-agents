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

interface RepoActivityData {
  repo: string
  chatCount: number
  messageCount: number
}

interface RepoActivityChartProps {
  data: RepoActivityData[]
}

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#0088FE",
  "#a4de6c",
  "#d0ed57",
]

export function RepoActivityChart({ data }: RepoActivityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No repository data available
      </div>
    )
  }

  // Truncate repo names for display
  const displayData = data.map((item) => ({
    ...item,
    displayName: item.repo === "__new__"
      ? "No repo"
      : item.repo.length > 20
        ? "..." + item.repo.slice(-17)
        : item.repo,
  }))

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={displayData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 120, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis type="number" tick={{ fontSize: 12 }} className="text-muted-foreground" />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
            width={115}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            labelFormatter={(_, payload) => {
              if (payload && payload[0]) {
                const data = payload[0].payload as RepoActivityData & { displayName: string }
                return data.repo === "__new__" ? "No repository" : data.repo
              }
              return ""
            }}
            formatter={(value, name) => [
              value,
              name === "chatCount" ? "Chats" : "Messages",
            ]}
          />
          <Bar dataKey="chatCount" name="Chats" radius={[0, 4, 4, 0]}>
            {displayData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
