"use client"

import type { RefObject } from "react"
import { ChevronRight, Loader2, CheckCircle2, XCircle, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * "succeeded"/"failed" reflect a real `done` event (the job actually exited,
 * with or without an error). "reconnecting"/"disconnected" reflect the SSE
 * connection itself, neither of which is evidence the job failed.
 */
export type SetupLogState = "running" | "reconnecting" | "succeeded" | "failed" | "disconnected"

export interface SetupLogPanelProps {
  state: SetupLogState
  statusLabel: string
  output: string
  connectionMessage?: string | null
  expanded: boolean
  onToggleExpanded: () => void
  /** Omit to hide the "Try again" affordance entirely (a caller with nothing
   *  safe to retry, e.g. a run that would just spin up another sandbox). */
  onRetry?: () => void
  logId: string
  logRef: RefObject<HTMLPreElement | null>
}

/**
 * The collapsible header + log body shared by every "streamed setup-script
 * output" surface in the app: the chat's own {@link SetupBlock} (which gates
 * a turn and can be dispatched) and the environment editor's "Run setup"
 * check (a standalone run with no turn to gate). Pulled out so the two
 * render identically and don't drift, while their different state machines
 * stay in their own components.
 */
export function SetupLogPanel({
  state,
  statusLabel,
  output,
  connectionMessage,
  expanded,
  onToggleExpanded,
  onRetry,
  logId,
  logRef,
}: SetupLogPanelProps) {
  return (
    <div className="rounded-md border border-border bg-muted/30 text-sm">
      <div className="w-full flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={logId}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
        >
          <ChevronRight
            className={cn("w-3.5 h-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          />
          {(state === "running" || state === "reconnecting") && (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          )}
          {state === "succeeded" && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />}
          {state === "failed" && <XCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />}
          {state === "disconnected" && (
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-yellow-700 dark:text-yellow-400" />
          )}
          <span
            aria-live="polite"
            className={cn(
              "truncate",
              state === "failed" && "text-destructive",
              state === "disconnected" && "text-yellow-700 dark:text-yellow-400"
            )}
          >
            {statusLabel}
          </span>
        </button>
        {state === "disconnected" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 text-xs underline underline-offset-2 hover:no-underline cursor-pointer"
          >
            Try again
          </button>
        )}
      </div>

      {expanded && (
        <pre
          id={logId}
          ref={logRef}
          className="max-h-64 overflow-auto px-3 pb-3 text-xs font-mono whitespace-pre-wrap"
        >
          {connectionMessage && (state === "reconnecting" || state === "disconnected")
            ? `${connectionMessage}\n\n`
            : ""}
          {output || (state === "running" || state === "reconnecting" ? "Waiting for output…" : "(no output)")}
        </pre>
      )}
    </div>
  )
}
