import type { CSSProperties } from "react"

/**
 * Shared styling for recharts <Tooltip> across the admin charts.
 *
 * Spread `chartTooltipProps` onto a <Tooltip> to apply the common content,
 * label and item styling, then add chart-specific props (cursor, formatter,
 * labelFormatter) as needed.
 */
export const chartTooltipProps: {
  contentStyle: CSSProperties
  labelStyle: CSSProperties
  itemStyle: CSSProperties
} = {
  contentStyle: {
    backgroundColor: "var(--tooltip-bg, #fff)",
    border: "1px solid var(--tooltip-border, #e5e7eb)",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    padding: "8px 12px",
  },
  labelStyle: { color: "var(--tooltip-text, #111)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "var(--tooltip-text, #111)", padding: "2px 0" },
}

/** Cursor style for line/area charts: a dashed vertical guide line. */
export const lineTooltipCursor = {
  stroke: "hsl(var(--muted-foreground))",
  strokeWidth: 1,
  strokeDasharray: "4 4",
}

/** Cursor style for bar charts: a translucent column highlight. */
export const barTooltipCursor = {
  fill: "hsl(var(--muted))",
  fillOpacity: 0.3,
}
