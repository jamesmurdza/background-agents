"use client"

import { useState } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#0088fe",
  "#00c49f",
  "#ff8042",
  "#a4de6c",
  "#d0ed57",
  "#83a6ed",
]

type ViewMode = "agents" | "models"
type TimeRange = "7d" | "30d"

interface MessagesByModelChartProps {
  agentData7d: Array<Record<string, number | string>>
  modelData7d: Array<Record<string, number | string>>
  agentData30d: Array<Record<string, number | string>>
  modelData30d: Array<Record<string, number | string>>
}

export function MessagesByModelChart({
  agentData7d,
  modelData7d,
  agentData30d,
  modelData30d,
}: MessagesByModelChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("agents")
  const [timeRange, setTimeRange] = useState<TimeRange>("7d")

  const getData = () => {
    if (viewMode === "agents") {
      return timeRange === "7d" ? agentData7d : agentData30d
    }
    return timeRange === "7d" ? modelData7d : modelData30d
  }

  const data = getData()
  const hasData = data && data.length > 0

  // Extract keys (all keys except "date")
  const dataKeys = hasData
    ? Array.from(
        new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== "date")))
      )
    : []

  return (
    <div className="h-[300px] w-full">
      {/* Toggle buttons */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("agents")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === "agents"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Agents
          </button>
          <button
            onClick={() => setViewMode("models")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === "models"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Models
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setTimeRange("7d")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              timeRange === "7d"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            7d
          </button>
          <button
            onClick={() => setTimeRange("30d")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              timeRange === "30d"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            30d
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="flex h-[250px] items-center justify-center text-muted-foreground">
          No {viewMode === "agents" ? "agent" : "model"} usage data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart
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
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
              labelStyle={{ color: "hsl(var(--popover-foreground))" }}
              labelFormatter={(label) => {
                const date = new Date(label)
                return date.toLocaleDateString()
              }}
              isAnimationActive={false}
            />
            <Legend />
            {dataKeys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stackId="1"
                stroke={COLORS[index % COLORS.length]}
                fill={COLORS[index % COLORS.length]}
                fillOpacity={0.6}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
