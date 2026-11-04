import type { UsageProvider } from "@/lib/query/hooks"

// Providers backed by a shared credential pool. Scoped one at a time so token
// counts and costs stay comparable within a view. Claude first — it's the
// pool most admins are watching day to day — then OpenCode, then Gemini.
export const USAGE_PROVIDERS: { key: UsageProvider; label: string }[] = [
  { key: "claude", label: "Claude" },
  { key: "opencode", label: "OpenCode" },
  { key: "gemini", label: "Gemini" },
]

/**
 * Providers whose usage is worth looking at in dollars.
 *
 * All three shared pools qualify today. OpenCode is billed per token, so the
 * figure is money we spend. Claude's shared pool is *budgeted* in dollars —
 * the admin view has to show the same measure the limiter enforces, or
 * there's no way to see why someone hit their cap. Gemini used to be excluded
 * here on the theory that it was capped by message count — that stopped being
 * true once gating moved to a single shared credit balance (see
 * lib/db/usage-limit) and Gemini got a real, admin-editable pricing
 * multiplier (see lib/server/credits and the Pricing tab): its list value is
 * computed the same way Claude's and OpenCode's are, so hiding it here was
 * stale, not intentional.
 */
export const COST_PROVIDERS: ReadonlySet<UsageProvider> = new Set<UsageProvider>([
  "opencode",
  "claude",
  "gemini",
])
