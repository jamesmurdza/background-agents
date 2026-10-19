"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUserUsageQuery } from "@/lib/query/hooks/useUserUsageQuery"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { fmtBalance, fmtTokens } from "@/lib/format"
import type { UsageDimension, UsageRange } from "@/lib/db/user-usage"
import { MobileSectionHeader } from "./shared"
import { ScopeCombobox, ACCOUNT_SCOPE } from "./ScopeCombobox"
import { SpendPerDayChart, type UsageMetricKey } from "./charts/SpendPerDayChart"

const RANGES: { key: UsageRange; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
]

const METRICS: { key: UsageMetricKey; label: string }[] = [
  { key: "credits", label: "Credits" },
  { key: "tokens", label: "Tokens" },
]

/** What the daily chart stacks by. */
const DIMENSIONS: { key: UsageDimension; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "model", label: "Model" },
  { key: "repo", label: "Repo" },
  { key: "chat", label: "Chat" },
]


interface UsageSectionProps {
  isMobile: boolean
  /** Scope to open with — the per-chat usage modal hands its chat through here. */
  initialScope?: string
}

/**
 * Usage: what the account has spent, and which agents spent it.
 *
 * The money here comes from the credit ledger rather than from re-pricing
 * tokens, so every figure reconciles with the balance on the Credits tab.
 * Tokens come from the usage ledger — they are the only story for own-key and
 * free-model runs, which spend nothing.
 */
export function UsageSection({ isMobile, initialScope = ACCOUNT_SCOPE }: UsageSectionProps) {
  const [range, setRange] = useState<UsageRange>("30d")
  const [metric, setMetric] = useState<UsageMetricKey>("credits")
  const [scope, setScope] = useState<string>(initialScope)
  const [dimension, setDimension] = useState<UsageDimension>("agent")

  const { status: sessionStatus } = useSession()
  const { data, isPending, isError } = useUserUsageQuery(range, scope, dimension)
  const { data: settings } = useSettingsQuery()
  // The query is disabled when logged out, which leaves it pending forever —
  // so signed-out gets its own branch rather than a skeleton that never fills.
  const isSignedOut = sessionStatus === "unauthenticated"
  const balanceUsd = settings?.availableCreditsUsd ?? null
  const gatedOnCredits = settings?.creditsMode === "balance"

  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 30
  const totals = data?.totals

  // Runway is the question a balance actually raises: not "how much is left"
  // but "how long does that last". Based on the window on screen, so changing
  // the range changes the assumption behind it — which is the honest reading.
  // Only meaningful for the whole account: a repo's burn rate says nothing
  // about how long the balance lasts, since everything else is spending it too.
  const isAccountScope = scope === ACCOUNT_SCOPE
  const dailyBurn = totals && rangeDays > 0 ? totals.creditsUsd / rangeDays : 0
  const runwayDays =
    isAccountScope && gatedOnCredits && balanceUsd !== null && dailyBurn > 0
      ? balanceUsd / dailyBurn
      : null

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={BarChart3} label="Usage" />}

      {/* Controls in one row above the charts. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
          value={range}
          onChange={setRange}
          ariaLabel="Date range"
        />
        <SegmentedControl
          options={METRICS}
          value={metric}
          onChange={setMetric}
          ariaLabel="Measure"
        />
        <ScopeCombobox
          value={scope}
          onChange={setScope}
          options={data?.scopeOptions}
          disabled={isSignedOut}
        />
      </div>

      {isSignedOut ? (
        <div className="rounded-lg border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          Sign in to see what you&apos;ve spent and which agents spent it.
        </div>
      ) : isError ? (
        <div className="py-3 text-sm text-destructive">
          Couldn&apos;t load your usage. Try again in a moment.
        </div>
      ) : isPending || !data ? (
        <UsageSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label={isAccountScope ? `Spent · ${rangeDays}d` : `Spent here · ${rangeDays}d`}
              value={fmtBalance(totals!.creditsUsd)}
              delta={pctDelta(totals!.creditsUsd, totals!.prevCreditsUsd)}
              hero
            />
            <StatTile
              label="Balance"
              value={balanceUsd === null ? "—" : fmtBalance(balanceUsd)}
              caption={
                !isAccountScope
                  ? "Whole account"
                  : !gatedOnCredits
                    ? "Not spent on your own keys"
                    : runwayDays === null
                      ? "No spend to project from"
                      : `≈ ${formatRunway(runwayDays)} at this rate`
              }
            />
            <StatTile
              label="Turns"
              value={totals!.turns.toLocaleString()}
              delta={pctDelta(totals!.turns, totals!.prevTurns)}
            />
            <StatTile
              label="Tokens"
              value={fmtTokens(totals!.tokens)}
              delta={pctDelta(totals!.tokens, totals!.prevTokens)}
            />
          </div>

          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">
                  {metric === "credits" ? "Credits per day" : "Tokens per day"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {metric === "credits"
                    ? "What came off your balance. Own-key and free-model runs cost nothing and don't appear here."
                    : "Every token recorded, including runs on your own keys."}
                </p>
              </div>
              <SegmentedControl
                options={DIMENSIONS}
                value={dimension}
                onChange={setDimension}
                ariaLabel="Stack by"
              />
            </div>
            <SpendPerDayChart
              daily={data.daily}
              series={data.series}
              dimension={data.dimension}
              metric={metric}
            />
          </div>
        </>
      )}
    </div>
  )
}

/** Percent change against the preceding window, or null when there's no base. */
function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/** "3 days" / "2 weeks" / "3 months" — precision that matches the confidence. */
function formatRunway(days: number): string {
  if (days < 1) return "under a day"
  if (days < 14) return `${Math.round(days)} days`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30)} months`
}

interface StatTileProps {
  label: string
  value: string
  /** Percent change vs the preceding window. */
  delta?: number | null
  caption?: string
  /** The one figure the tab leads with. */
  hero?: boolean
}

/**
 * A single figure with its change. Deliberately not a one-bar chart.
 *
 * The delta is neutral ink, never red/green: spending more than last month is
 * not in itself good or bad, and colouring it would be the page taking a view
 * it has no basis for.
 */
function StatTile({ label, value, delta, caption, hero = false }: StatTileProps) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-semibold tabular-nums leading-none",
          hero ? "text-3xl" : "text-xl"
        )}
      >
        {value}
      </div>
      {delta !== null && delta !== undefined && (
        <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}% vs previous
        </div>
      )}
      {caption && <div className="mt-1.5 text-[11px] text-muted-foreground">{caption}</div>}
    </div>
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-md border border-border/60 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors cursor-pointer",
            value === option.key
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="mt-6 h-[220px] animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
