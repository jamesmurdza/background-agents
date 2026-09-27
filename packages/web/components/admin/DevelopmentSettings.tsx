"use client"

import { useState } from "react"
import { Timer, Save, CheckCircle2, AlertCircle } from "lucide-react"
import {
  useAgentRunLimitsQuery,
  useSetAgentRunLimitsMutation,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

interface FieldConfig {
  key: "interactiveMinutes" | "scheduledMinutes"
  label: string
  description: string
}

const FIELDS: FieldConfig[] = [
  {
    key: "interactiveMinutes",
    label: "Interactive chat timeout",
    description:
      "How long an interactive chat's agent may run before the lifecycle cron force-stops it.",
  },
  {
    key: "scheduledMinutes",
    label: "Scheduled job timeout",
    description:
      "How long a scheduled job's agent may run before the lifecycle cron force-stops it.",
  },
]

/**
 * Admin panel for the max agent run duration — replaces the hardcoded
 * INTERACTIVE_HARD_TIMEOUT/SCHEDULED_HARD_TIMEOUT constants in
 * app/api/cron/agent-lifecycle/_lib/constants. Every tick, the agent-lifecycle
 * cron reads these limits (lib/db/agent-run-limits) and force-stops any run
 * that has been going longer.
 */
export function DevelopmentSettings() {
  const query = useAgentRunLimitsQuery()
  const mutation = useSetAgentRunLimitsMutation()
  // Uncommitted edits, keyed by field — separate from server state so a field
  // mid-edit doesn't get clobbered by the query's own refetch.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null)

  const data = query.data

  function draftFor(field: FieldConfig): string {
    if (drafts[field.key] !== undefined) return drafts[field.key]
    return data ? String(data[field.key]) : ""
  }

  function setDraft(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }))
  }

  const dirty = FIELDS.some((f) => data && drafts[f.key] !== undefined && drafts[f.key] !== String(data[f.key]))

  function save() {
    if (!data) return
    const interactiveMinutes = Number(draftFor(FIELDS[0]))
    const scheduledMinutes = Number(draftFor(FIELDS[1]))

    for (const [value, label] of [
      [interactiveMinutes, "Interactive chat timeout"],
      [scheduledMinutes, "Scheduled job timeout"],
    ] as const) {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
        setFeedback({ ok: false, message: `${label} must be a whole number of minutes >= 1` })
        return
      }
    }

    setFeedback(null)
    mutation.mutate(
      { interactiveMinutes, scheduledMinutes },
      {
        onSuccess: () => {
          setFeedback({ ok: true })
          setDrafts({})
        },
        onError: (err) =>
          setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) }),
      }
    )
  }

  return (
    <section className="space-y-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold md:text-xl">Development</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational limits for how agent runs behave. Past these durations,
          the agent-lifecycle cron force-stops the run and marks it as errored.
        </p>
      </div>

      <div className="max-w-3xl rounded-xl border bg-card shadow-sm">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="p-6 text-center text-sm text-destructive">
            Failed to load run limits.
          </p>
        ) : (
          <div className="divide-y">
            {FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-3 p-4 md:p-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <span className="font-medium">{field.label}</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
                </div>
                <div className="relative">
                  <Timer className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={draftFor(field)}
                    onChange={(e) => setDraft(field.key, e.target.value)}
                    className="w-28 rounded-lg border bg-background py-1.5 pl-7 pr-2 text-sm shadow-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="ml-2 text-xs text-muted-foreground">min</span>
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-3 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3">
                {data?.updatedAt ? (
                  <p className="text-[11px] text-muted-foreground">
                    Last changed {new Date(data.updatedAt).toLocaleString()}
                    {data.updatedBy ? ` by ${data.updatedBy}` : ""}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || mutation.isPending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  <Save className={cn("h-3.5 w-3.5", mutation.isPending && "animate-pulse")} />
                  Save
                </button>
              </div>

              {feedback && (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                    feedback.ok
                      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                >
                  {feedback.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{feedback.ok ? "Saved." : feedback.message}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
