"use client"

import { useState } from "react"
import { KeyRound, RefreshCw, Zap, CheckCircle2, AlertCircle } from "lucide-react"
import { useRefreshClaudeCredsMutation } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

type Outcome =
  | { ok: true; label: string; expiresAt?: number }
  | { ok: false; message: string }

export function ClaudeCredentials() {
  const [cookies, setCookies] = useState("")
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const mutation = useRefreshClaudeCredsMutation()

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

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold md:text-xl">Claude Credentials</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Regenerate the shared Claude OAuth token from the stored claude.ai
          cookies. <span className="font-medium">Refresh</span> no-ops while the
          current token still has plenty of life;{" "}
          <span className="font-medium">Force refresh</span> regenerates it
          regardless.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm space-y-4">
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
    </section>
  )
}
