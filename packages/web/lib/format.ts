/**
 * Shared display formatting helpers for Simple Chat.
 */

/** Compact token count: 950 → "950", 12_345 → "12.3K", 1_200_000 → "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** The unit a shared-pool budget is measured in. */
export type UsageUnit = "tokens" | "cost" | "messages"

/**
 * Split a usage amount into its formatted value and (optional) unit label for
 * the given budget unit. Callers render the parts as a plain string or JSX.
 *
 * @example
 * formatUsageParts(1500, "tokens")  // => { value: "1.5K", label: "tokens" }
 * formatUsageParts(2.5, "cost")     // => { value: "$2.50", label: "" }
 * formatUsageParts(1, "messages")   // => { value: "1", label: "message" }
 */
export function formatUsageParts(n: number, unit: UsageUnit): { value: string; label: string } {
  if (unit === "cost") return { value: `$${n.toFixed(2)}`, label: "" }
  if (unit === "messages") {
    const rounded = Math.round(n)
    return { value: String(rounded), label: rounded === 1 ? "message" : "messages" }
  }
  return { value: fmtTokens(n), label: "tokens" }
}
