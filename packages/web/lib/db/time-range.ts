/**
 * Shared time-range helpers for admin analytics routes.
 *
 * Centralizes the `range` query-param vocabulary and its mapping to a day count
 * / Postgres interval literal so the admin routes (stats, top-users, ...) don't
 * each re-implement the same switch — and can't drift in how a given range is
 * interpreted.
 */

/** Bounded ranges that map to a concrete day count. */
export type FiniteTimeRange = "24h" | "7d" | "30d"
/** All accepted range values, including the unbounded "all". */
export type TimeRange = FiniteTimeRange | "all"

const RANGE_TO_DAYS: Record<FiniteTimeRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
}

/** Number of days covered by a bounded range. */
export function getRangeDays(range: FiniteTimeRange): number {
  return RANGE_TO_DAYS[range]
}

/**
 * Postgres interval literal for a bounded range (e.g. "7 days"), suitable for
 * `NOW() - ${interval}::interval` in a raw query.
 */
export function getRangeInterval(range: FiniteTimeRange): string {
  return `${RANGE_TO_DAYS[range]} days`
}

/**
 * Parses a `range` query param into a bounded range, falling back when the
 * value is missing or unrecognized (or is the unbounded "all").
 */
export function parseFiniteTimeRange(
  value: string | null,
  fallback: FiniteTimeRange
): FiniteTimeRange {
  return value === "24h" || value === "7d" || value === "30d" ? value : fallback
}

/**
 * Parses a `range` query param into any accepted range (including "all"),
 * falling back when the value is missing or unrecognized.
 */
export function parseTimeRange(value: string | null, fallback: TimeRange): TimeRange {
  if (value === "all" || value === "24h" || value === "7d" || value === "30d") return value
  return fallback
}
