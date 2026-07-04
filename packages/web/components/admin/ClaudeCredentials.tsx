"use client"

import { useState } from "react"
import {
  KeyRound,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  History,
} from "lucide-react"
import {
  useRefreshClaudeCredsMutation,
  useCcAuthRunsQuery,
  type CcAuthRun,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

type Outcome =
  | { ok: true; label: string; expiresAt?: number }
  | { ok: false; message: string }

/** Human-friendly duration: "820 ms", "4.2 s", or "2 m 5 s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m} m ${s} s`
}

const STATUS_STYLES: Record<string, string> = {
  refreshed: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  skipped: "border-muted-foreground/20 bg-muted text-muted-foreground",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "border-muted-foreground/20 bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  )
}

export function ClaudeCredentials() {
  const [cookies, setCookies] = useState("")
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const mutation = useRefreshClaudeCredsMutation()
  const runsQuery = useCcAuthRunsQuery()

  const run = (force: boolean) => {
    setOutcome(null)
    mutation.mutate(
      { force, cookies: cookies.trim() || undefined },
      {
        onSuccess: (data) =>
          setOutcome({
            ok: true,
            label: data.refreshed
              ? "Credentials refreshed."
              : data.skipped
                ? "Skipped — current token is still fresh (use Force refresh to override)."
                : "Done.",
            expiresAt: data.expiresAt,
          }),
        onError: (err) =>
          setOutcome({
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          }),
      },
    )
  }

  const pending = mutation.isPending
  const pendingForce = pending && mutation.variables?.force === true
  const pendingNormal = pending && mutation.variables?.force !== true

  const runs = runsQuery.data?.runs ?? []

  return (
    <section className="space-y-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold md:text-xl">Claude Credentials</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Regenerate the shared Claude OAuth token from the stored claude.ai
          cookies. <span className="font-medium">Refresh</span> no-ops while the
          current token still has plenty of life;{" "}
          <span className="font-medium">Force refresh</span> regenerates it
          regardless.
        </p>
      </div>

      <div className="max-w-2xl rounded-xl border bg-card p-4 md:p-6 shadow-sm space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="claude-cookies"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            New cookies (optional)
          </label>
          <p className="text-xs text-muted-foreground">
            Paste fresh claude.ai cookies JSON to rotate them before refreshing.
            Leave blank to reuse the stored cookies.
          </p>
          <textarea
            id="claude-cookies"
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder='[{"name":"sessionKey","value":"..."}, ...]'
            spellCheck={false}
            rows={6}
            className="w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-xs shadow-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all",
              "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <RefreshCw
              className={cn("h-4 w-4", pendingNormal && "animate-spin")}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <Zap className={cn("h-4 w-4", pendingForce && "animate-pulse")} />
            Force refresh
          </button>
        </div>

        {pending && (
          <p className="text-xs text-muted-foreground">
            Running ccauth in Daytona — the first run can take a few minutes…
          </p>
        )}

        {outcome && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-sm",
              outcome.ok
                ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {outcome.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="space-y-0.5">
              <p>{outcome.ok ? outcome.label : outcome.message}</p>
              {outcome.ok && outcome.expiresAt && (
                <p className="text-xs opacity-80">
                  Token expires {new Date(outcome.expiresAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Run history */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b p-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Refresh history</h3>
          </div>
          <button
            type="button"
            onClick={() => runsQuery.refetch()}
            disabled={runsQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", runsQuery.isFetching && "animate-spin")}
            />
            Reload
          </button>
        </div>

        <RunHistory
          runs={runs}
          isLoading={runsQuery.isLoading}
          isError={runsQuery.isError}
        />
      </div>
    </section>
  )
}

function RunHistory({
  runs,
  isLoading,
  isError,
}: {
  runs: CcAuthRun[]
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <p className="p-6 text-center text-sm text-destructive">
        Failed to load refresh history.
      </p>
    )
  }

  if (runs.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No refresh runs recorded yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Trigger</th>
            <th className="px-4 py-2 font-medium">Duration</th>
            <th className="px-4 py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b last:border-0 align-top">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-2.5">
                <span className="capitalize">{r.trigger}</span>
                {r.forced && (
                  <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                    forced
                  </span>
                )}
                {r.cookiesUpdated && (
                  <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-600 dark:text-amber-400">
                    cookies
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                {formatDuration(r.durationMs)}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {r.status === "error" ? (
                  <span className="text-destructive">
                    {r.code}
                    {r.message ? `: ${r.message}` : ""}
                  </span>
                ) : r.expiresAt ? (
                  <>Token expires {new Date(r.expiresAt).toLocaleString()}</>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
