"use client"

import type { StatsTimeRange } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

export interface SegmentedOption<K extends string> {
  key: K
  label: string
  /** Tooltip for the individual button. */
  hint?: string
}

/** Pill-style single-select button group used across the admin dashboard. */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  disabled = false,
  disabledHint,
}: {
  options: readonly SegmentedOption<K>[]
  value: K
  onChange: (key: K) => void
  /** Greys out the whole group and shows no active option. */
  disabled?: boolean
  /** Tooltip shown on the group and every button while disabled. */
  disabledHint?: string
}) {
  return (
    <div
      className={cn("flex gap-1 rounded-lg bg-muted p-1", disabled && "opacity-50")}
      title={disabled ? disabledHint : undefined}
    >
      {options.map((option) => (
        <button
          key={option.key}
          onClick={() => onChange(option.key)}
          disabled={disabled}
          title={disabled ? disabledHint : option.hint}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
            disabled && "cursor-not-allowed",
            !disabled && value === option.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const TIME_RANGE_OPTIONS: SegmentedOption<StatsTimeRange>[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
]

export function TimeRangeSelector({
  value,
  onChange,
}: {
  value: StatsTimeRange
  onChange: (range: StatsTimeRange) => void
}) {
  return <SegmentedControl options={TIME_RANGE_OPTIONS} value={value} onChange={onChange} />
}

/** Switch controlling whether admin users' own activity is counted. */
export function IncludeAdminsToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all sm:text-sm",
        checked
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full bg-background transition-transform",
            checked ? "translate-x-3" : "translate-x-0"
          )}
        />
      </span>
      Include admins
    </button>
  )
}
