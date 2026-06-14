"use client"

import { useEffect, useState } from "react"
import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSectionHeader } from "./shared"
import type { UsageResponse, PoolUsage } from "@/app/api/user/usage/route"

/** Compact token count: 950 → "950", 12_345 → "12.3K", 1_200_000 → "1.2M". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Tailwind classes for the bar fill based on how close to the limit we are. */
function fillClass(pct: number): string {
  if (pct >= 1) return "bg-red-500"
  if (pct >= 0.8) return "bg-amber-500"
  return "bg-primary"
}

function PoolBar({ pool }: { pool: PoolUsage }) {
  const unlimited = pool.limit == null
  const pct = unlimited ? 0 : Math.min(1, pool.used / Math.max(1, pool.limit!))

  return (
    <div className="py-3 border-b border-border/30 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium">{pool.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pool.ownKey ? (
            "Your own key"
          ) : unlimited ? (
            <>
              {fmtTokens(pool.used)} tokens{" "}
              <span className="text-primary">· Unlimited</span>
            </>
          ) : (
            <>
              {fmtTokens(pool.used)} / {fmtTokens(pool.limit!)} tokens
            </>
          )}
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {pool.ownKey ? null : (
          <div
            className={cn(
              "h-full rounded-full transition-all",
              unlimited ? "bg-primary/40" : fillClass(pct)
            )}
            style={{ width: unlimited ? "100%" : `${Math.max(2, pct * 100)}%` }}
          />
        )}
      </div>

      {(pool.ownKey || !unlimited) && (
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {pool.ownKey
            ? "Using your own key — shared pool not used"
            : `${fmtTokens(Math.max(0, pool.limit! - pool.used))} left`}
        </div>
      )}
    </div>
  )
}

interface UsageSectionProps {
  isMobile: boolean
}

/**
 * Daily token usage for each shared credential pool. Free users see their usage
 * against the per-provider daily budget; Pro users and own-key providers show as
 * unlimited. The "tokens" shown are the cache-excluded limited measure that the
 * rate limiter actually counts.
 */
export function UsageSection({ isMobile }: UsageSectionProps) {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetch("/api/user/usage")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load usage (${res.status})`)
        return (await res.json()) as UsageResponse
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load usage")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Gauge} label="Usage" />}

      <p className="text-xs text-muted-foreground mb-2">
        Daily token usage on the shared credential pools. Resets at 00:00 UTC.
        Cache reads aren&apos;t counted toward limits.
      </p>

      {error ? (
        <div className="text-sm text-destructive py-3">{error}</div>
      ) : !data ? (
        <div className="space-y-3 py-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              <div className="h-2 w-full rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div>
          {data.pools.map((pool) => (
            <PoolBar key={pool.provider} pool={pool} />
          ))}
          {data.isPro && (
            <p className="text-[11px] text-primary mt-2">
              Pro plan — shared pools are unlimited. Usage shown for reference.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
