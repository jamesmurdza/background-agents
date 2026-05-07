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

interface MessagesChatsData {
  time: string
  messages: number
  chats: number
}

interface DailyMessagesChatsChartProps {
  data: MessagesChatsData[]
  isHourly?: boolean
}

function formatHour(hour: number): string {
  if (hour === 0) return "12am"
  if (hour === 12) return "12pm"
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}

export function DailyMessagesChatsChart({ data, isHourly = false }: DailyMessagesChatsChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
        No data available
      </div>
    )
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(value) => {
              if (isHourly) {
                return formatHour(Number(value))
              }
              const date = new Date(value)
              return `${date.getMonth() + 1}/${date.getDate()}`
            }}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={{ stroke: "hsl(var(--border))" }}
            interval={isHourly ? 3 : "preserveStartEnd"}
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
            labelFormatter={(label) => {
              if (isHourly) {
                return formatHour(Number(label))
              }
              const date = new Date(label)
              return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
          />
          <Line
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="hsl(262, 83%, 58%)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="chats"
            name="Conversations"
            stroke="hsl(152, 60%, 50%)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
