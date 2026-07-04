"use client"

import { useEffect, useState } from "react"
import { Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSectionHeader } from "./shared"
import type { UsageResponse, PoolUsage } from "@/app/api/user/usage/route"
import { fmtTokens } from "@/lib/format"

/** Format an amount in a pool's budget unit (tokens / USD cost / messages). */
function fmtUsage(n: number, unit: PoolUsage["unit"]): string {
  if (unit === "cost") return `$${n.toFixed(2)}`
  if (unit === "messages") return `${Math.round(n)} ${Math.round(n) === 1 ? "message" : "messages"}`
  return `${fmtTokens(n)} tokens`
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
              {fmtUsage(pool.used, pool.unit)}{" "}
              <span className="text-primary">· Unlimited</span>
            </>
          ) : (
            <>
              {fmtUsage(pool.used, pool.unit)} / {fmtUsage(pool.limit!, pool.unit)}
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
            : `${fmtUsage(Math.max(0, pool.limit! - pool.used), pool.unit)} left`}
        </div>
      )}
    </div>
  )
}

interface UsageSectionProps {
  isMobile: boolean
}

/**
 * Daily token usage for each shared credential pool. Free and Pro users see
 * their usage against the per-provider daily budget (Pro's is 2× the free one);
 * unlimited-plan users and own-key providers show as unlimited. The "tokens"
 * shown are the cache-excluded limited measure that the rate limiter counts.
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
        Daily usage on the shared credential pools. Resets at 00:00 UTC. Each
        pool has its own limit (tokens, cost, or messages); cache reads
        aren&apos;t counted.
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
          {data.plan === "unlimited" ? (
            <p className="text-[11px] text-primary mt-2">
              Unlimited plan — shared pools are uncapped. Usage shown for reference.
            </p>
          ) : data.plan === "pro" ? (
            <p className="text-[11px] text-primary mt-2">
              Pro plan — 2× the free daily budget on each shared pool.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
