import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { UsageProvider, UserUsage, UsageDistribution } from "@/lib/query/hooks"

// Providers backed by a shared credential pool. Scoped one at a time so token
// counts and costs stay comparable within a view. Claude first — it's the
// pool most admins are watching day to day — then OpenCode, then Gemini.
export const USAGE_PROVIDERS: { key: UsageProvider; label: string }[] = [
  { key: "claude", label: "Claude" },
  { key: "opencode", label: "OpenCode" },
  { key: "gemini", label: "Gemini" },
]

/**
 * Merge per-provider usage rows into one roster, summing across whichever
 * providers are selected. Used only by the Leaderboard's Usage by user table:
 * unlike the Overview's charts (which stay scoped to one provider so token
 * counts and costs remain comparable within a single view — see USAGE_PROVIDERS),
 * the table's job is "how much has this user cost us, full stop," so it
 * defaults to combining all three.
 */
export function combineUsageByProvider(
  perProvider: Partial<Record<UsageProvider, UserUsage[]>>,
  selected: UsageProvider[]
): UserUsage[] {
  const map = new Map<string, UserUsage>()
  for (const provider of selected) {
    for (const u of perProvider[provider] ?? []) {
      const existing = map.get(u.userId)
      if (!existing) {
        map.set(u.userId, { ...u, models: [...u.models] })
        continue
      }
      existing.tokens += u.tokens
      existing.cost += u.cost
      existing.sharedTokens += u.sharedTokens
      existing.sharedCost += u.sharedCost
      existing.ownTokens += u.ownTokens
      existing.ownCost += u.ownCost
      existing.models.push(...u.models)
    }
  }
  return [...map.values()]
    .map((u) => ({ ...u, models: [...u.models].sort((a, b) => b.tokens - a.tokens) }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

/**
 * Merge each provider's day-by-user (or hour-by-user, for the 24h range) List
 * value series into one, summing by (time, userId) across whichever providers
 * are selected — the same combination `combineUsageByProvider` does for the
 * table's totals, just time-bucketed for the chart above it.
 */
export function combineByUserOverTime(
  perProvider: Partial<Record<UsageProvider, UsageDistribution>>,
  selected: UsageProvider[],
  isHourly = false
): Array<Record<string, number | string>> {
  const byTime = new Map<string, Record<string, number | string>>()
  for (const provider of selected) {
    const rows = perProvider[provider]?.byUser.cost ?? []
    for (const row of rows) {
      const time = String(row.time)
      const entry = byTime.get(time) ?? { time }
      for (const [key, value] of Object.entries(row)) {
        if (key === "time") continue
        entry[key] = (Number(entry[key]) || 0) + (Number(value) || 0)
      }
      byTime.set(time, entry)
    }
  }
  // Hourly time keys are "0".."23" — a plain string sort would put "10" before
  // "2", so sort numerically in that case; day keys ("YYYY-MM-DD") sort fine
  // lexicographically.
  return [...byTime.values()].sort((a, b) =>
    isHourly
      ? Number(a.time) - Number(b.time)
      : String(a.time).localeCompare(String(b.time))
  )
}

/** Multi-select "Providers" filter for the Leaderboard's Usage by user table —
 * replaces a three-way single-select toggle, since the table can now combine
 * more than one provider at once (defaults to all). */
export function ProviderFilterDropdown({
  selected,
  onChange,
}: {
  selected: UsageProvider[]
  onChange: (next: UsageProvider[]) => void
}) {
  const toggle = (key: UsageProvider) => {
    if (selected.includes(key)) {
      // Refuse to drop the last provider — an empty filter would just render
      // an empty table with no visible way back in.
      if (selected.length === 1) return
      onChange(selected.filter((p) => p !== key))
    } else {
      onChange([...selected, key])
    }
  }

  const label =
    selected.length === USAGE_PROVIDERS.length
      ? "All providers"
      : selected.length === 1
        ? (USAGE_PROVIDERS.find((p) => p.key === selected[0])?.label ?? "Providers")
        : `${selected.length} providers`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-transparent bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:text-foreground sm:text-sm"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {USAGE_PROVIDERS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.key}
            checked={selected.includes(option.key)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(option.key)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
