"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { chartTooltipProps, lineTooltipCursor } from "./chartTooltip"
import {
  CATEGORICAL_COLORS,
  formatAxisDate,
  formatMetricValue,
  formatTooltipDate,
} from "./chartFormatters"
import type { UsageMetric } from "@/lib/query/hooks"

/** Rows written before per-key attribution shipped carry no fingerprint. */
const UNATTRIBUTED = "unattributed"
const UNATTRIBUTED_COLOR = "hsl(var(--muted-foreground))"

interface UsageByKeyChartProps {
  data: Array<Record<string, number | string>>
  keyIds: string[]
  metric: UsageMetric
}

/**
 * Shared-pool usage split by which key served it.
 *
 * The pool picks a key at random per turn, so a healthy pool trends toward an
 * even split. A single dominant band means selection is not spreading — either
 * only one key is configured, or the rotation is not reaching production.
 */
export function UsageByKeyChart({ data, keyIds, metric }: UsageByKeyChartProps) {
  const fmt = (v: number) => formatMetricValue(metric, v)

  // Totals per key, used both for legend ordering and the balance summary.
  const totals: Record<string, number> = {}
  for (const row of data) {
    for (const id of keyIds) {
      totals[id] = (totals[id] || 0) + Number(row[id] || 0)
    }
  }
  const grandTotal = Object.values(totals).reduce((acc, v) => acc + v, 0)

  const ordered = [...keyIds].sort((a, b) => {
    if (a === UNATTRIBUTED) return 1
    if (b === UNATTRIBUTED) return -1
    return (totals[b] || 0) - (totals[a] || 0)
  })

  if (grandTotal === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center px-6 text-center text-muted-foreground text-sm">
        No per-key data yet. Attribution starts from the first shared OpenCode turn
        after this feature shipped — earlier rows have no key recorded.
      </div>
    )
  }

  // Only the attributed keys are meaningful for a balance read.
  const attributed = ordered.filter((id) => id !== UNATTRIBUTED)
  const attributedTotal = attributed.reduce((acc, id) => acc + (totals[id] || 0), 0)
  const topShare =
    attributed.length > 0 && attributedTotal > 0
      ? (Math.max(...attributed.map((id) => totals[id] || 0)) / attributedTotal) * 100
      : 0
  // With N keys an even split is 100/N each; flag when one key is taking well
  // over its share (>1.5×), which is the signature of rotation not working.
  const evenShare = attributed.length > 0 ? 100 / attributed.length : 100
  const isImbalanced = attributed.length > 1 && topShare > evenShare * 1.5

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatAxisDate}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={{ stroke: "hsl(var(--border))" }}
              width={50}
              tickFormatter={(v) => fmt(Number(v))}
            />
            <Tooltip
              {...chartTooltipProps}
              cursor={lineTooltipCursor}
              labelFormatter={(label) => formatTooltipDate(label)}
              formatter={(value) => fmt(Number(value))}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} itemSorter={null} />
            {ordered.map((id, index) => {
              const color =
                id === UNATTRIBUTED
                  ? UNATTRIBUTED_COLOR
                  : CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]
              return (
                <Area
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={id === UNATTRIBUTED ? "unattributed" : `…${id}`}
                  stackId="1"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.6}
                  legendType={id === UNATTRIBUTED ? "diamond" : "rect"}
                  isAnimationActive={false}
                />
              )
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {attributed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {attributed.length === 1 ? (
            <>
              Only <span className="font-medium text-foreground">one key</span> has served
              traffic in this range. If the pool is meant to hold several, check that
              <code className="mx-1 rounded bg-muted px-1">OPENCODE_API_KEY</code>
              is comma-separated in the deployed environment.
            </>
          ) : isImbalanced ? (
            <>
              Busiest key is carrying{" "}
              <span className="font-medium text-foreground">{topShare.toFixed(0)}%</span> of
              attributed usage across {attributed.length} keys — an even split would be ~
              {evenShare.toFixed(0)}% each. Selection is random per turn, so a persistent
              skew means turn sizes differ a lot, not that rotation is broken.
            </>
          ) : (
            <>
              Spread across {attributed.length} keys, busiest at{" "}
              <span className="font-medium text-foreground">{topShare.toFixed(0)}%</span> (even
              split ≈ {evenShare.toFixed(0)}%).
            </>
          )}
        </p>
      )}
    </div>
  )
}
