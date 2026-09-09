"use client"

import { useState } from "react"
import { DollarSign, Save, Gift, CheckCircle2, AlertCircle } from "lucide-react"
import {
  useProviderPricingQuery,
  useSetProviderMultiplierMutation,
  type ProviderPricingRow,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  gemini: "Gemini",
}

/**
 * Plain-English readout of what a multiplier means, next to the raw number —
 * "0.05" alone doesn't say whether that's a steep discount or a typo.
 */
function multiplierSummary(multiplier: number): string {
  if (multiplier === 0) return "Free — no credits charged, never blocks on balance"
  if (multiplier === 1) return "Full list price"
  if (multiplier < 1) {
    const pct = multiplier * 100
    const subsidy = 1 / multiplier
    return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(pct < 10 ? 1 : 0)}% of list price (${subsidy.toFixed(subsidy < 10 ? 1 : 0)}× subsidy)`
  }
  return `${multiplier}× list price`
}

/**
 * Admin panel for the per-provider pricing multiplier — replaces the old
 * hardcoded DISCOUNT_DIVISOR constant. `chargeable = listUsd * multiplier`,
 * so lower is cheaper for the user, and exactly 0 makes the provider free:
 * chargeTurnToCredits charges nothing and checkSharedPoolUsage never blocks a
 * send on balance for it (see lib/db/provider-pricing).
 *
 * Scoped to the shared-pool providers (claude/opencode/gemini) — nothing else
 * is ever charged, so a multiplier for another provider would be a knob that
 * does nothing.
 */
export function ProviderPricing() {
  const query = useProviderPricingQuery()
  const mutation = useSetProviderMultiplierMutation()
  // Uncommitted edits, keyed by provider — separate from server state so a
  // row mid-edit doesn't get clobbered by the query's own refetch.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<
    { provider: string; ok: true } | { provider: string; ok: false; message: string } | null
  >(null)

  const rows = query.data?.providers ?? []

  function draftFor(row: ProviderPricingRow): string {
    return drafts[row.provider] ?? String(row.multiplier)
  }

  function setDraft(provider: string, value: string) {
    setDrafts((d) => ({ ...d, [provider]: value }))
  }

  function commit(provider: string, multiplier: number) {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      setFeedback({ provider, ok: false, message: "Multiplier must be a number ≥ 0" })
      return
    }
    setFeedback(null)
    mutation.mutate(
      { provider, multiplier },
      {
        onSuccess: () => {
          setFeedback({ provider, ok: true })
          setDrafts((d) => {
            const next = { ...d }
            delete next[provider]
            return next
          })
        },
        onError: (err) =>
          setFeedback({
            provider,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          }),
      }
    )
  }

  function save(row: ProviderPricingRow) {
    commit(row.provider, Number(draftFor(row)))
  }

  function makeFree(row: ProviderPricingRow) {
    setDraft(row.provider, "0")
    commit(row.provider, 0)
  }

  return (
    <section className="space-y-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold md:text-xl">Pricing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What each shared-pool provider charges against a user&apos;s credit
          balance, as a multiplier of API list value —{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            charged = list value × multiplier
          </code>
          . Set a provider to <span className="font-medium">0</span> to make it
          fully free: no credits are charged, and users are never blocked from
          sending on that provider for lack of balance.
        </p>
      </div>

      <div className="max-w-3xl rounded-xl border bg-card shadow-sm">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="p-6 text-center text-sm text-destructive">
            Failed to load pricing.
          </p>
        ) : (
          <div className="divide-y">
            {rows.map((row) => {
              const draft = draftFor(row)
              const draftNumber = Number(draft)
              const dirty = draft !== String(row.multiplier)
              const isFree = row.multiplier === 0
              const rowFeedback = feedback?.provider === row.provider ? feedback : null
              const pending = mutation.isPending && mutation.variables?.provider === row.provider

              return (
                <div key={row.provider} className="flex flex-col gap-3 p-4 md:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {PROVIDER_LABELS[row.provider] ?? row.provider}
                        </span>
                        {isFree && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-green-600 dark:text-green-400">
                            <Gift className="h-3 w-3" />
                            Free
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {multiplierSummary(row.multiplier)}
                      </p>
                      {row.updatedAt && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Last changed {new Date(row.updatedAt).toLocaleString()}
                          {row.updatedBy ? ` by ${row.updatedBy}` : ""}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draft}
                          onChange={(e) => setDraft(row.provider, e.target.value)}
                          className="w-28 rounded-lg border bg-background py-1.5 pl-7 pr-2 text-sm shadow-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => save(row)}
                        disabled={!dirty || pending || !Number.isFinite(draftNumber) || draftNumber < 0}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                          "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        )}
                      >
                        <Save className={cn("h-3.5 w-3.5", pending && "animate-pulse")} />
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => makeFree(row)}
                        disabled={isFree || pending}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                          "disabled:cursor-not-allowed disabled:opacity-50"
                        )}
                      >
                        <Gift className="h-3.5 w-3.5" />
                        Make free
                      </button>
                    </div>
                  </div>

                  {rowFeedback && (
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                        rowFeedback.ok
                          ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      )}
                    >
                      {rowFeedback.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{rowFeedback.ok ? "Saved." : rowFeedback.message}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
