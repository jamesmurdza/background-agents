import type { Agent } from "@/lib/types"

// =============================================================================
// Timezone Helpers
// =============================================================================

/** Get the user's timezone offset in hours (e.g., -8 for PST) */
export function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset() / 60
}

/** Get short timezone name (e.g., "PST", "EST") */
export function getTimezoneName(): string {
  return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(part => part.type === 'timeZoneName')?.value ?? 'Local'
}

/** Convert local hour (0-23) to UTC hour */
export function localHourToUtc(localHour: number): number {
  const offset = getTimezoneOffset()
  let utcHour = localHour - offset
  if (utcHour < 0) utcHour += 24
  if (utcHour >= 24) utcHour -= 24
  return Math.floor(utcHour)
}

/** Convert UTC hour (0-23) to local hour */
export function utcHourToLocal(utcHour: number): number {
  const offset = getTimezoneOffset()
  let localHour = utcHour + offset
  if (localHour < 0) localHour += 24
  if (localHour >= 24) localHour -= 24
  return Math.floor(localHour)
}

// =============================================================================
// Trigger / Schedule Constants
// =============================================================================

export const TRIGGER_TYPES = [
  {
    label: "On a schedule",
    value: "interval",
    description: "Run at regular intervals"
  },
  {
    label: "Via webhook",
    value: "incoming",
    description: "Triggered by any external app (GitHub, Jira, Slack, Linear, …) — paste the generated URL into the source app"
  },
] as const

export const INTERVAL_PRESETS = [
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "Hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "Day", value: 1440 },
  { label: "Week", value: 10080 },
]

export const CUSTOM_INTERVAL = -1

export type IntervalUnit = "minutes" | "hours" | "days" | "weeks"

export const UNIT_MINUTES: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
}

export const INTERVAL_UNITS: { label: string; value: IntervalUnit }[] = [
  { label: "minutes", value: "minutes" },
  { label: "hours", value: "hours" },
  { label: "days", value: "days" },
  { label: "weeks", value: "weeks" },
]

/** Express a stored intervalMinutes as either a preset or a (value, unit) pair. */
export function inferIntervalMode(minutes: number): {
  isCustom: boolean
  intervalMinutes: number
  customValue: number
  customUnit: IntervalUnit
} {
  if (INTERVAL_PRESETS.some((p) => p.value === minutes)) {
    return { isCustom: false, intervalMinutes: minutes, customValue: 10, customUnit: "minutes" }
  }
  if (minutes % 10080 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 10080, customUnit: "weeks" }
  }
  if (minutes % 1440 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 1440, customUnit: "days" }
  }
  if (minutes % 60 === 0) {
    return { isCustom: true, intervalMinutes: minutes, customValue: minutes / 60, customUnit: "hours" }
  }
  return { isCustom: true, intervalMinutes: minutes, customValue: minutes, customUnit: "minutes" }
}

export const DAYS_OF_WEEK = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
]

export const TIME_OPTIONS = [
  { label: "12:00 AM", value: 0 },
  { label: "1:00 AM", value: 1 },
  { label: "2:00 AM", value: 2 },
  { label: "3:00 AM", value: 3 },
  { label: "4:00 AM", value: 4 },
  { label: "5:00 AM", value: 5 },
  { label: "6:00 AM", value: 6 },
  { label: "7:00 AM", value: 7 },
  { label: "8:00 AM", value: 8 },
  { label: "9:00 AM", value: 9 },
  { label: "10:00 AM", value: 10 },
  { label: "11:00 AM", value: 11 },
  { label: "12:00 PM", value: 12 },
  { label: "1:00 PM", value: 13 },
  { label: "2:00 PM", value: 14 },
  { label: "3:00 PM", value: 15 },
  { label: "4:00 PM", value: 16 },
  { label: "5:00 PM", value: 17 },
  { label: "6:00 PM", value: 18 },
  { label: "7:00 PM", value: 19 },
  { label: "8:00 PM", value: 20 },
  { label: "9:00 PM", value: 21 },
  { label: "10:00 PM", value: 22 },
  { label: "11:00 PM", value: 23 },
]

export const AVAILABLE_AGENTS: Agent[] = ["opencode", "claude-code", "codex"]
