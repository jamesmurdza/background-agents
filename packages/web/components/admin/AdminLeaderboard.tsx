"use client"

import { useState } from "react"
import { Users, BarChart3, ChevronDown } from "lucide-react"
import {
  IncludeAdminsToggle,
  TimeRangeSelector,
} from "@/components/admin/DashboardControls"
import { ChartCard } from "@/components/admin/ChartCard"
import { UsageByUserAreaChart } from "@/components/admin/charts/UsageByUserAreaChart"
import { UsageByUserTable } from "@/components/admin/UsageByUserTable"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useUsageDistributionQuery,
  useAdminTopupsQuery,
  type StatsTimeRange,
  type UsageProvider,
  type UsageRange,
  type UserUsage,
  type UsageDistribution,
} from "@/lib/query/hooks"
import { sortByTimeKey } from "@/lib/time-series"
import { COST_PROVIDERS, USAGE_PROVIDERS } from "./usage-providers"

/**
 * Merge per-provider usage rows into one roster, summing across whichever
 * providers are selected. Unlike the Overview's charts (which stay scoped to
 * one provider so token counts and costs remain comparable within a single
 * view — see USAGE_PROVIDERS), the table's job is "how much has this user
 * cost us, full stop," so it defaults to combining all three.
 */
function combineUsageByProvider(
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
function combineByUserOverTime(
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
  return sortByTimeKey([...byTime.values()], isHourly)
}

/** Multi-select "Providers" filter for the Usage by user table — replaces a
 * three-way single-select toggle, since the table can now combine more than
 * one provider at once (defaults to all). */
function ProviderFilterDropdown({
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

interface AdminLeaderboardProps {
  // Global time range + admins toggle are shared with the Overview tab, so
  // they live in the parent and are passed down rather than owned here.
  globalTimeRange: StatsTimeRange
  onGlobalTimeRangeChange: (range: StatsTimeRange) => void
  includeAdmins: boolean
  onIncludeAdminsChange: (include: boolean) => void
}

export function AdminLeaderboard({
  globalTimeRange,
  onGlobalTimeRangeChange,
  includeAdmins,
  onIncludeAdminsChange,
}: AdminLeaderboardProps) {
  // Which providers feed the Usage by user table (default: all three).
  const [usageProviderFilter, setUsageProviderFilter] = useState<UsageProvider[]>([
    "claude",
    "opencode",
    "gemini",
  ])
  // Which users are checked in the table — read by the stacked-area-by-user
  // chart above it. null = everyone (see UsageByUserTableProps).
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string> | null>(null)

  const isHourly = globalTimeRange === "24h"
  // The distribution view is day-bucketed, so it has no "all" range. Follow
  // the global range where it can and fall back to 30d for "all".
  const usageRange: UsageRange = globalTimeRange === "all" ? "30d" : globalTimeRange

  // One query per shared-pool provider. Fetching all three unconditionally
  // (rather than only the filtered ones) keeps this a fixed set of hook calls
  // and lets react-query dedupe with the Overview's usage query whenever it
  // happens to be on the same provider — no extra request.
  const claudeUsageQuery = useUsageDistributionQuery(usageRange, "claude", !includeAdmins)
  const opencodeUsageQuery = useUsageDistributionQuery(usageRange, "opencode", !includeAdmins)
  const geminiUsageQuery = useUsageDistributionQuery(usageRange, "gemini", !includeAdmins)
  // Top-up payments by user. Shares the global time range and admins toggle
  // rather than adding another set of controls; same query the Overview's
  // "Top-ups over time" chart makes, so react-query dedupes the request.
  const topupsQuery = useAdminTopupsQuery(globalTimeRange, !includeAdmins)

  const leaderboardUsers = combineUsageByProvider(
    {
      claude: claudeUsageQuery.data?.users,
      opencode: opencodeUsageQuery.data?.users,
      gemini: geminiUsageQuery.data?.users,
    },
    usageProviderFilter
  )
  const leaderboardUsageLoading =
    claudeUsageQuery.isLoading || opencodeUsageQuery.isLoading || geminiUsageQuery.isLoading
  const leaderboardShowCost = usageProviderFilter.some((p) => COST_PROVIDERS.has(p))
  // Stacked-area-by-user chart, same provider combination as the table below it.
  const leaderboardByUserSeries = combineByUserOverTime(
    {
      claude: claudeUsageQuery.data,
      opencode: opencodeUsageQuery.data,
      gemini: geminiUsageQuery.data,
    },
    usageProviderFilter,
    isHourly
  )

  return (
    <>
      {/* Global Time Range Selector — shared with Overview. The Metric and
          Pool selectors live there because they weight those charts; this
          tab's one table (Usage by user) always shows both Tokens and List
          value, and has its own provider filter below, scoped to what it
          actually shows. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold md:text-xl">Leaderboard</h2>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <IncludeAdminsToggle checked={includeAdmins} onChange={onIncludeAdminsChange} />
          <TimeRangeSelector value={globalTimeRange} onChange={onGlobalTimeRangeChange} />
        </div>
      </div>

      {/* Usage by user — its own provider filter, since it isn't scoped by
          the Overview's metric selector. Tokens and List value both show as
          columns now (no toggle needed); the Topped up/Balance/Spent columns
          come from the credit ledger (topupsQuery), merged in below rather
          than shown as separate tables/charts. The chart and table below
          share this filter and the table's own checkbox selection. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-semibold md:text-xl">Usage by user</h2>
          <p className="text-xs text-muted-foreground">
            Per-user breakdown of shared pool usage
            {globalTimeRange === "all" && " · last 30 days"}
          </p>
        </div>
        <ProviderFilterDropdown
          selected={usageProviderFilter}
          onChange={setUsageProviderFilter}
        />
      </div>

      <section className="grid gap-4 md:gap-6">
        {/* Stacked area: List value over time, one band per checked user in
            the table below — the table IS this chart's series picker, not a
            separate control. */}
        <ChartCard
          icon={BarChart3}
          iconClassName="bg-violet-500/10 text-violet-500"
          title="List value over time by user"
          isLoading={leaderboardUsageLoading}
          skeletonHeight={280}
        >
          <UsageByUserAreaChart
            data={leaderboardByUserSeries}
            users={leaderboardUsers}
            selectedUserIds={selectedUserIds}
            isHourly={isHourly}
          />
        </ChartCard>

        <ChartCard
          icon={Users}
          iconClassName="bg-indigo-500/10 text-indigo-500"
          title="Usage by user"
        >
          <UsageByUserTable
            users={leaderboardUsers}
            ledger={topupsQuery.data?.users ?? []}
            balances={topupsQuery.data?.balances ?? []}
            showCost={leaderboardShowCost}
            selectedUserIds={selectedUserIds}
            onSelectionChange={setSelectedUserIds}
            isLoading={leaderboardUsageLoading || topupsQuery.isLoading}
          />
        </ChartCard>
      </section>
    </>
  )
}
