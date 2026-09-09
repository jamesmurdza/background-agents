/**
 * Shared display formatting helpers for Simple Chat.
 */

/**
 * The final path segment of a file path, for display.
 * "src/lib/foo.ts" → "foo.ts". Falls back to the input when there is no slash.
 */
export function basename(path: string): string {
  return path.split("/").pop() || path
}

/** Compact token count: 950 → "950", 12_345 → "12.3K", 1_200_000 → "1.2M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * Format a balance for display: "$5.00", "$4.20", or "<$0.01".
 *
 * A credit is a dollar, so the balance reads as money — "$0.25", not
 * "0.25 credits". The sub-cent case matters: individual turns cost well under a
 * cent on the cheaper providers, so a running total would otherwise read
 * "$0.00" and look broken.
 *
 * For a single ledger entry rather than a balance, use {@link fmtCreditAmount}
 * — "<$0.01" is fine as a summary but useless as the amount of one charge.
 */
export function fmtBalance(n: number): string {
  return n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`
}

/**
 * Format a credit balance or one movement of it: "$0.2500", "$0.1223", "$0.0044".
 *
 * Four decimals, always, and never "<$0.01" the way {@link fmtBalance} does.
 * Turn costs are multiplied by the provider's pricing multiplier before they
 * reach the balance (see lib/server/credits), which puts a typical charge
 * around a cent and many below it — at two decimals a balance would visibly
 * disagree with the charges that produced it, and half the ledger would read
 * "<$0.01".
 *
 * Unsigned: the balance and the ledger each apply their own sign, since one
 * wants "-$1.20" and the other "+$0.25".
 *
 * Not for money the user pays or for API list value — those are real dollars and
 * belong in {@link fmtBalance}.
 */
export function fmtCreditAmount(n: number): string {
  return `$${Math.abs(n).toFixed(4)}`
}
