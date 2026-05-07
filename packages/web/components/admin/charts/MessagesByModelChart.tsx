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

// Refined color palette that works in both light and dark modes
const COLORS = [
  "hsl(262, 83%, 58%)",  // Purple
  "hsl(152, 60%, 50%)",  // Teal
  "hsl(38, 92%, 50%)",   // Amber
  "hsl(199, 89%, 48%)",  // Blue
  "hsl(340, 82%, 52%)",  // Pink
  "hsl(25, 95%, 53%)",   // Orange
  "hsl(173, 80%, 40%)",  // Cyan
  "hsl(280, 65%, 60%)",  // Violet
]

type ViewMode = "agents" | "models"

interface MessagesByModelChartProps {
  agentData: Array<Record<string, number | string>>
  modelData: Array<Record<string, number | string>>
  isHourly?: boolean
}

function formatHour(hour: number): string {
  if (hour === 0) return "12am"
  if (hour === 12) return "12pm"
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}

export function MessagesByModelChart({
  agentData,
  modelData,
  isHourly = false,
}: MessagesByModelChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("agents")

  const data = viewMode === "agents" ? agentData : modelData
  const hasData = data && data.length > 0

  // Extract keys (all keys except "time")
  const dataKeys = hasData
    ? Array.from(
        new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== "time")))
      )
    : []

  return (
    <div className="space-y-3">
      {/* Toggle buttons - only view mode, time is controlled globally */}
      <div className="flex items-center">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => setViewMode("agents")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === "agents"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Agents
          </button>
          <button
            onClick={() => setViewMode("models")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === "models"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Models
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="flex h-[220px] items-center justify-center text-muted-foreground text-sm">
          No {viewMode === "agents" ? "agent" : "model"} usage data available
        </div>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
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
                isAnimationActive={false}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
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
        </div>
      )}
    </div>
  )
}
