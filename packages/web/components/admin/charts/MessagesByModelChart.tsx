"use client"

import { useState } from "react"
import { TrendingUp } from "lucide-react"
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
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import {
  formatAxisDate,
  formatTooltipDate,
  formatHour,
  formatMetricValue,
  type StatsMetric,
} from "./chartFormatters"

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
  "hsl(217, 91%, 60%)",  // Indigo
]

// Neutral color for the collapsed long-tail "Other" series.
const OTHER_KEY = "Other"
const OTHER_COLOR = "hsl(var(--muted-foreground))"

type ViewMode = "agents" | "models"

interface MessagesByModelChartProps {
  agentData: Array<Record<string, number | string>>
  modelData: Array<Record<string, number | string>>
  metric: StatsMetric
  metricName: string
  isHourly?: boolean
}

export function MessagesByModelChart({
  agentData,
  modelData,
  metric,
  metricName,
  isHourly = false,
}: MessagesByModelChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("agents")

  const data = viewMode === "agents" ? agentData : modelData
  const hasData = data && data.length > 0

  // Extract keys (all keys except "time"), keeping "Other" pinned to the end
  // so the collapsed long-tail series always sorts last in the stack/legend.
  const dataKeys = hasData
    ? Array.from(
        new Set(data.flatMap((entry) => Object.keys(entry).filter((key) => key !== "time")))
      ).sort((a, b) => {
        if (a === OTHER_KEY) return 1
        if (b === OTHER_KEY) return -1
        return 0
      })
    : []

  return (
    <div className="space-y-3">
      {/* Header: icon + dynamic title on the left, view-mode toggle on the right */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </div>
          <h3 className="font-medium">
            {metricName} by {viewMode === "agents" ? "Agent" : "Model"}
          </h3>
        </div>
        {/* Toggle - only view mode, time is controlled globally */}
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
                tickFormatter={(value) =>
                  isHourly ? formatHour(Number(value)) : formatAxisDate(value)
                }
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={{ stroke: "hsl(var(--border))" }}
                interval={isHourly ? 3 : "preserveStartEnd"}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={{ stroke: "hsl(var(--border))" }}
                width={50}
                tickFormatter={(value) => formatMetricValue(metric, Number(value))}
              />
              <Tooltip
                {...chartTooltipProps}
                cursor={lineTooltipCursor}
                labelFormatter={(label) =>
                  isHourly ? formatHour(Number(label)) : formatTooltipDate(label)
                }
                formatter={(value) => formatMetricValue(metric, Number(value))}
                isAnimationActive={false}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {dataKeys.map((key, index) => {
                const color = key === OTHER_KEY ? OTHER_COLOR : COLORS[index % COLORS.length]
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="1"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.6}
                    isAnimationActive={false}
                  />
                )
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
