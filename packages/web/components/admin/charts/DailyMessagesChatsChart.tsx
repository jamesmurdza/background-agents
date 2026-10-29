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
import { chartTooltipProps, lineTooltipCursor } from "@/components/charts/chartTooltip"
import { timeSeriesGridProps, timeSeriesXAxisProps, valueYAxisProps } from "@/components/charts/chartAxes"
import { ChartEmptyState } from "./ChartEmptyState"
import {
  formatTooltipDate,
  formatHour,
  formatMetricValue,
  metricLabel,
  type StatsMetric,
} from "@/components/charts/chartFormatters"

interface SeriesPoint {
  time: string
  value: number
  value2: number | null
}

interface DailyMessagesChatsChartProps {
  data: SeriesPoint[]
  metric: StatsMetric
  isHourly?: boolean
}

export function DailyMessagesChatsChart({
  data,
  metric,
  isHourly = false,
}: DailyMessagesChatsChartProps) {
  if (!data || data.length === 0) {
    return <ChartEmptyState message="No data available" />
  }

  // "messages" carries a second series (conversations); tokens/cost is single-value.
  const showSecondary = metric === "messages"
  const primaryName = metricLabel(metric)

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid {...timeSeriesGridProps} />
          <XAxis {...timeSeriesXAxisProps(isHourly)} />
          <YAxis {...valueYAxisProps((value) => formatMetricValue(metric, value))} />
          <Tooltip
            {...chartTooltipProps}
            cursor={lineTooltipCursor}
            labelFormatter={(label) =>
              isHourly ? formatHour(Number(label)) : formatTooltipDate(label)
            }
            formatter={(value) => formatMetricValue(metric, Number(value))}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            name={primaryName}
            stroke="hsl(262, 83%, 58%)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {showSecondary && (
            <Line
              type="monotone"
              dataKey="value2"
              name="Conversations"
              stroke="hsl(152, 60%, 50%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
