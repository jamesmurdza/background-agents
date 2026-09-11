"use client"

import { useEffect, useState } from "react"
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
import { lineTooltipCursor, SingleAreaTooltipContent, useSingleAreaHover } from "./chartTooltip"
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
  const { hoveredKey, getHoverHandlers, reset: resetHover } = useSingleAreaHover()

  const data = viewMode === "agents" ? agentData : modelData
  const hasData = data && data.length > 0

  // A stale hoveredKey from the other view (e.g. an agent id that isn't a
  // model id) would just render no tooltip, but clear it anyway so switching
  // views doesn't leave a phantom hover state.
  useEffect(() => {
    resetHover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  // Total usage per series, used to order the legend/stack by most-used first.
  const totals: Record<string, number> = {}
  if (hasData) {
    for (const entry of data) {
      for (const key of Object.keys(entry)) {
        if (key === "time") continue
        totals[key] = (totals[key] || 0) + Number(entry[key] || 0)
      }
    }
  }

  // Extract keys (all keys except "time"), sorted by total usage descending
  // and keeping the collapsed long-tail "Other" series pinned to the end.
  const dataKeys = hasData
    ? Object.keys(totals).sort((a, b) => {
        if (a === OTHER_KEY) return 1
        if (b === OTHER_KEY) return -1
        return totals[b] - totals[a]
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
        <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
          No {viewMode === "agents" ? "agent" : "model"} usage data available
        </div>
      ) : (
        <div className="h-[250px] w-full">
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
              {/* Only shows a tooltip for the specific band the mouse is over
                  (see useSingleAreaHover) — AreaChart has no built-in
                  per-item hover mode, so `active`/`content` fake one. */}
              <Tooltip
                active={hoveredKey !== null}
                cursor={hoveredKey !== null ? lineTooltipCursor : false}
                content={(props) => (
                  <SingleAreaTooltipContent
                    {...props}
                    hoveredKey={hoveredKey}
                    formatValue={(v) => formatMetricValue(metric, v)}
                    formatLabel={(label) =>
                      isHourly ? formatHour(Number(label)) : formatTooltipDate(label)
                    }
                  />
                )}
                isAnimationActive={false}
              />
              {/* itemSorter={null} keeps the legend in our usage-sorted Area
                  order instead of recharts' default alphabetical sort. */}
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} itemSorter={null} />
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
                    legendType={key === OTHER_KEY ? "diamond" : "rect"}
                    isAnimationActive={false}
                    {...getHoverHandlers(key)}
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
