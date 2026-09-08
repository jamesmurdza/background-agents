"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronRight, Loader2, CheckCircle2, XCircle, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

interface SetupBlockProps {
  chatId: string
  /** True while the chat is in `setting_up`; drives whether we open a stream.
   *  Once it flips back to false the block keeps showing its last known
   *  state (collapsed on success, expanded on failure) rather than
   *  disappearing mid-review. */
  active: boolean
  /** Called only once a real `done` event says the job actually exited (with
   *  either outcome). Never called after giving up on a broken connection:
   *  that is explicitly the case where nothing here can say what happened. */
  onFinished?: () => void
}

/**
 * "succeeded"/"failed" reflect a real `done` event (the script actually
 * exited, with or without an error). "reconnecting"/"disconnected" reflect
 * the SSE connection itself, not the script: the route's own 5-minute
 * `maxDuration` can legitimately cut a still-running, still-fine script off
 * mid-stream (SETUP_TIMEOUT_SECONDS allows up to 10), and a network hiccup is
 * even less informative than that. Neither is evidence the script failed.
 */
type State = "running" | "reconnecting" | "succeeded" | "failed" | "disconnected"

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_BASE_DELAY_MS = 1000

/**
 * Live setup-script progress for a chat's first turn.
 *
 * Purely event-driven off the `/api/chats/[chatId]/setup` SSE stream for the
 * script's own output: there is no client-side polling loop, so a `done`
 * event that arrives with no preceding `output` events still resolves the
 * block immediately instead of leaving it waiting for log lines that will
 * never come. A broken *connection* (as opposed to a `done` event reporting a
 * real script failure) is retried with a bounded backoff rather than reported
 * as a failure; see the State comment above.
 */
export function SetupBlock({ chatId, active, onFinished }: SetupBlockProps) {
  const [output, setOutput] = useState("")
  const [state, setState] = useState<State>("running")
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const logRef = useRef<HTMLPreElement>(null)
  const logId = useId()

  useEffect(() => {
    if (!active) return

    let cancelled = false
    let retries = 0
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    // A fresh run for this chat: reset in case a previous run's state is
    // still sitting here (e.g. this instance is being reused after a repo
    // switch landed on another chat that's also setting up).
    setOutput("")
    setState("running")
    setConnectionMessage(null)
    setExpanded(false)

    const connect = () => {
      source = new EventSource(`/api/chats/${chatId}/setup`)

      source.addEventListener("output", (event) => {
        setOutput((prev) => prev + (JSON.parse((event as MessageEvent).data).raw as string))
      })
      source.addEventListener("done", (event) => {
        const { exitCode, state: jobState } = JSON.parse((event as MessageEvent).data) as {
          exitCode: number | null
          state: string
        }
        const failed = jobState !== "exited" || exitCode !== 0
        setState(failed ? "failed" : "succeeded")
        // A failure is worth reading; a success is noise once it's over.
        if (failed) setExpanded(true)
        source?.close()
        onFinished?.()
      })
      source.addEventListener("error", (event) => {
        source?.close()
        if (cancelled) return

        // The route's own best-effort `error` event carries a message; a
        // plain connection-level failure (network drop, the route's
        // maxDuration cutting the response off) has no `.data` at all.
        let message: string | null = null
        try {
          const data = (event as MessageEvent).data
          if (data) message = (JSON.parse(data) as { message?: string }).message ?? null
        } catch {
          /* connection-level Event, not a MessageEvent: no data to read */
        }

        if (retries < MAX_RECONNECT_ATTEMPTS) {
          retries += 1
          setState("reconnecting")
          setConnectionMessage(message)
          retryTimer = setTimeout(connect, RECONNECT_BASE_DELAY_MS * retries)
        } else {
          // Give up honestly: this says the connection was lost, not that the
          // script failed, because the server was explicitly designed to let
          // a script outlive one HTTP response (see SETUP_TIMEOUT_SECONDS vs.
          // the route's maxDuration) and be picked up again, just not by this
          // component without the user asking it to.
          setState("disconnected")
          setConnectionMessage(message)
          setExpanded(true)
        }
      })
    }

    connect()

    return () => {
      cancelled = true
      source?.close()
      if (retryTimer) clearTimeout(retryTimer)
    }
    // onFinished is a stable-enough callback from the caller; including it
    // would reopen the stream on every parent re-render. `attempt` exists
    // purely to let "Try again" force this effect to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, active, attempt])

  // Follow the tail while it streams.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [output])

  const statusLabel =
    state === "running"
      ? "Setting up environment"
      : state === "reconnecting"
        ? "Reconnecting…"
        : state === "succeeded"
          ? "Environment ready"
          : state === "failed"
            ? "Setup failed, continuing anyway"
            : "Connection lost, setup may still be running"

  return (
    <div className="rounded-md border border-border bg-muted/30 text-sm">
      <div className="w-full flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
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
        {state === "disconnected" && (
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
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
