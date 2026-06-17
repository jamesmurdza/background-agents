/**
 * Shared value formatters for the admin charts.
 *
 * These are used by recharts tick/label/tooltip formatters, which pass the
 * raw axis value (a date string or numeric hour) as `any`.
 */

/** Format a date value as a compact "M/D" axis tick, e.g. "5/27". */
export function formatAxisDate(value: string | number): string {
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** Format a date value as a long tooltip label, e.g. "Tue, May 27". */
export function formatTooltipDate(value: string | number): string {
  const date = new Date(value)
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

/** Format an hour (0-23) as a 12-hour label, e.g. "12am", "3pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return "12am"
  if (hour === 12) return "12pm"
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}

/** Dashboard metric the charts are weighted by. */
export type StatsMetric = "tokens" | "cost" | "messages"

/** Human label for a metric, e.g. for chart titles and legends. */
export function metricLabel(metric: StatsMetric): string {
  switch (metric) {
    case "cost":
      return "Cost"
    case "messages":
      return "Messages"
    default:
      return "Tokens"
  }
}

/** Compact large numbers, e.g. 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

/** Format a USD amount with precision scaled to its magnitude. */
export function formatCost(value: number): string {
  if (value === 0) return "$0"
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  if (Math.abs(value) < 1) return `$${value.toFixed(3)}`
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Format a numeric value according to the selected metric. */
export function formatMetricValue(metric: StatsMetric, value: number): string {
  if (metric === "cost") return formatCost(value)
  if (metric === "tokens") return formatCompactNumber(value)
  return Math.round(value).toLocaleString()
}
