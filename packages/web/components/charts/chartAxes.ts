/**
 * Shared recharts axis/grid configuration for the admin charts.
 *
 * Every time-series chart here plots a "time" dataKey on the x-axis (ticked
 * by hour-of-day for the 24h range, by day otherwise) and a numeric value on
 * the y-axis (ticked via the chart's own value formatter). Spread these onto
 * <CartesianGrid>/<XAxis>/<YAxis> instead of re-typing the styling per chart.
 */

import type { ComponentProps } from "react"
import { CartesianGrid, XAxis, YAxis } from "recharts"
import { formatAxisDate, formatHour } from "./chartFormatters"

/** Shared <CartesianGrid> styling — horizontal lines only, muted border color. */
export const timeSeriesGridProps: ComponentProps<typeof CartesianGrid> = {
  strokeDasharray: "3 3",
  stroke: "hsl(var(--border))",
  vertical: false,
}

/**
 * Shared <XAxis> props for a "time" dataKey, ticking by hour-of-day when
 * `isHourly` (the 24h range) or by calendar day otherwise.
 */
export function timeSeriesXAxisProps(isHourly: boolean): ComponentProps<typeof XAxis> {
  return {
    dataKey: "time",
    tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
    tickFormatter: (value) => (isHourly ? formatHour(Number(value)) : formatAxisDate(value)),
    axisLine: { stroke: "hsl(var(--border))" },
    tickLine: { stroke: "hsl(var(--border))" },
    interval: isHourly ? 3 : "preserveStartEnd",
  }
}

/** Shared <YAxis> props that format ticks via the chart's own value formatter. */
export function valueYAxisProps(formatValue: (value: number) => string): ComponentProps<typeof YAxis> {
  return {
    tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
    axisLine: { stroke: "hsl(var(--border))" },
    tickLine: { stroke: "hsl(var(--border))" },
    width: 50,
    tickFormatter: (value) => formatValue(Number(value)),
  }
}
