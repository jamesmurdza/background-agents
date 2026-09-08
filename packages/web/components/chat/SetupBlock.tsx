"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface SetupBlockProps {
  chatId: string
  /** True while the chat is in `setting_up`; drives whether we open a stream.
   *  Once it flips back to false the block keeps showing its last known
   *  state (collapsed on success, expanded on failure) rather than
   *  disappearing mid-review. */
  active: boolean
  /** Called once the job has exited (or the stream itself broke) so the
   *  caller can refresh the chat: the queued turn was dispatched server-side
   *  the moment this fires, with nothing here to show it starting. */
  onFinished?: () => void
}

type State = "running" | "succeeded" | "failed"

/**
 * Live setup-script progress for a chat's first turn.
 *
 * Purely event-driven off the `/api/chats/[chatId]/setup` SSE stream: there is
 * no client-side polling loop, so a `done` event that arrives with no
 * preceding `output` events still resolves the block immediately instead of
 * leaving it waiting for log lines that will never come.
 */
export function SetupBlock({ chatId, active, onFinished }: SetupBlockProps) {
  const [output, setOutput] = useState("")
  const [state, setState] = useState<State>("running")
  const [expanded, setExpanded] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const logId = useId()

  useEffect(() => {
    if (!active) return

    // A fresh run for this chat: reset in case a previous run's state is
    // still sitting here (e.g. this instance is being reused after a repo
    // switch landed on another chat that's also setting up).
    setOutput("")
    setState("running")
    setExpanded(false)

    const source = new EventSource(`/api/chats/${chatId}/setup`)

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
      source.close()
      onFinished?.()
    })
    source.addEventListener("error", () => {
      // The stream itself broke (network hiccup, server restart) rather than
      // the script exiting non-zero. Either way the spinner must not spin
      // forever: resolve to failed so the block reads as "something went
      // wrong" instead of hanging.
      setState("failed")
      setExpanded(true)
      source.close()
    })

    return () => source.close()
    // onFinished is a stable-enough callback from the caller; including it
    // would reopen the stream on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, active])

  // Follow the tail while it streams.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [output])

  const statusLabel =
    state === "running"
      ? "Setting up environment"
      : state === "succeeded"
        ? "Environment ready"
        : "Setup failed, continuing anyway"

  return (
    <div className="rounded-md border border-border bg-muted/30 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={logId}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <ChevronRight
          className={cn("w-3.5 h-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        {state === "running" && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
        {state === "succeeded" && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />}
        {state === "failed" && <XCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />}
        <span aria-live="polite" className={cn(state === "failed" && "text-destructive")}>
          {statusLabel}
        </span>
      </button>

      {expanded && (
        <pre
          id={logId}
          ref={logRef}
          className="max-h-64 overflow-auto px-3 pb-3 text-xs font-mono whitespace-pre-wrap"
        >
          {output || (state === "running" ? "Waiting for output…" : "(no output)")}
        </pre>
      )}
    </div>
  )
}
