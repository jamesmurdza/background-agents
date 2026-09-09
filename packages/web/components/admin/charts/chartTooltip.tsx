"use client"

import { useCallback, useState, type CSSProperties } from "react"
import type { TooltipContentProps } from "recharts"

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

/**
 * Tracks which single stacked series the mouse is currently over, keyed by
 * its `dataKey`.
 *
 * Recharts' `AreaChart` only supports axis-shared tooltips (hover anywhere
 * on the x-axis shows every series stacked at that point) — there is no
 * built-in "hover this one band" mode the way Bar/Pie charts have. This hook
 * plus {@link SingleAreaTooltipContent} fake that: each `<Area>` reports
 * mouse enter/leave through the handlers returned here (recharts forwards
 * native SVG mouse events straight through to the rendered path, regardless
 * of the chart-level tooltip mode), and the content renderer below only ever
 * shows the one series currently hovered.
 */
export function useSingleAreaHover() {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const getHoverHandlers = useCallback(
    (key: string) => ({
      onMouseEnter: () => setHoveredKey(key),
      // Guard against clobbering a newer selection if the leave event for one
      // area fires after the enter event for the adjacent one it was swapped for.
      onMouseLeave: () => setHoveredKey((k) => (k === key ? null : k)),
    }),
    []
  )

  return { hoveredKey, getHoverHandlers, reset: () => setHoveredKey(null) }
}

/**
 * Tooltip `content` renderer for the single-area-hover pattern above: shows
 * only the payload entry matching `hoveredKey`, with a color swatch, and
 * nothing at all when no area is hovered (rather than recharts' default of
 * showing every series at the nearest x).
 */
export function SingleAreaTooltipContent({
  active,
  payload,
  label,
  hoveredKey,
  formatValue,
  formatLabel,
}: TooltipContentProps & {
  hoveredKey: string | null
  formatValue: (value: number) => string
  formatLabel?: (label: string | number) => React.ReactNode
}) {
  if (!active || !payload || hoveredKey === null) return null
  const entry = payload.find((p) => String(p.dataKey) === hoveredKey)
  if (!entry || entry.value == null || Number(entry.value) <= 0) return null

  return (
    <div style={chartTooltipProps.contentStyle}>
      <p style={chartTooltipProps.labelStyle}>
        {formatLabel ? formatLabel(label ?? "") : String(label ?? "")}
      </p>
      <div
        style={{
          ...chartTooltipProps.itemStyle,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: entry.color,
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1 }}>{entry.name}</span>
        <span style={{ fontWeight: 600 }}>{formatValue(Number(entry.value))}</span>
      </div>
    </div>
  )
}
