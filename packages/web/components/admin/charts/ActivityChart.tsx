"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

interface ActivityData {
  date: string
  login?: number
  chat_created?: number
  message_sent?: number
  [key: string]: string | number | undefined
}

interface ActivityChartProps {
  data: ActivityData[]
}

const COLORS = {
  login: "#8884d8",
  chat_created: "#82ca9d",
  message_sent: "#ffc658",
}

const LABELS = {
  login: "Logins",
  chat_created: "Chats Created",
  message_sent: "Messages Sent",
}

export function ActivityChart({ data }: ActivityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No activity data available
      </div>
    )
  }

  // Determine which metrics are present in the data
  const metrics = Object.keys(COLORS).filter((key) =>
    data.some((d) => d[key] !== undefined && d[key] !== null)
  )

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => {
              const date = new Date(value)
              return `${date.getMonth() + 1}/${date.getDate()}`
            }}
            className="text-muted-foreground"
          />
          <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
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
          />
          <Legend />
          {metrics.map((metric) => (
            <Line
              key={metric}
              type="monotone"
              dataKey={metric}
              name={LABELS[metric as keyof typeof LABELS] || metric}
              stroke={COLORS[metric as keyof typeof COLORS]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
