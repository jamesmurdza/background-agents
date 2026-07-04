/**
 * Shared display formatting helpers for Simple Chat.
 */

/** Compact token count: 950 → "950", 12_345 → "12.3K", 1_200_000 → "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}
