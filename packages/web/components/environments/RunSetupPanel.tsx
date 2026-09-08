"use client"

import { useEffect, useId, useRef, useState } from "react"
import { SetupLogPanel, type SetupLogState } from "@/components/chat/SetupLogPanel"

interface RunSetupPanelProps {
  environmentId: string
  /** Bumped by the caller (the "Run setup" button) each time a fresh run
   *  should start. Changing it re-opens the stream from scratch. */
  runToken: number
  /** Reports the run's state on every change, so the caller can disable its
   *  "Run setup" button only while a run is actually in flight (a real
   *  sandbox exists) rather than for the panel's whole lifetime. */
  onStateChange?: (state: SetupLogState) => void
}

/**
 * Streams one throwaway run of an environment's saved setup script from
 * GET /api/environments/[id]/run-setup. Reuses SetupLogPanel's rendering
 * (see that file) so this doesn't grow a second copy of the log markup.
 *
 * Deliberately does NOT reconnect on a dropped connection the way SetupBlock
 * does: SetupBlock's stream polls a job that already exists and keeps running
 * in the sandbox regardless of who's watching, so a reconnect just resumes
 * watching it. This route's stream IS the run: connecting creates a fresh
 * throwaway sandbox and deleting it is exactly what ends the connection on
 * this end, so an automatic reconnect would silently create (and bill for)
 * a second sandbox. A dropped connection here is reported and left to the
 * user to retry explicitly via "Run setup" (which bumps runToken).
 */
export function RunSetupPanel({ environmentId, runToken, onStateChange }: RunSetupPanelProps) {
  const [output, setOutput] = useState("")
  const [state, setState] = useState<SetupLogState>("running")
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const logRef = useRef<HTMLPreElement>(null)
  const logId = useId()

  useEffect(() => {
    onStateChange?.(state)
    // Fires on every state change; onStateChange is expected to be a stable
    // callback (or the caller accepts re-subscribing), same convention as
    // SetupBlock's onFinished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    setOutput("")
    setState("running")
    setConnectionMessage(null)
    setExpanded(true)

    const source = new EventSource(`/api/environments/${environmentId}/run-setup`)

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
      if (failed) setExpanded(true)
      source.close()
    })
    source.addEventListener("error", (event) => {
      // Always close, never let the browser's own auto-reconnect fire: see
      // the class comment above for why a reconnect here means a second
      // sandbox, not a resumed view of the first one.
      source.close()

      let message: string | null = null
      try {
        const data = (event as MessageEvent).data
        if (data) message = (JSON.parse(data) as { message?: string }).message ?? null
      } catch {
        /* connection-level Event, not a MessageEvent: no data to read */
      }
      setState("disconnected")
      setConnectionMessage(message)
      setExpanded(true)
    })

    return () => {
      source.close()
    }
  }, [environmentId, runToken])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [output])

  const statusLabel =
    state === "running"
      ? "Running setup script"
      : state === "succeeded"
        ? "Setup script succeeded"
        : state === "failed"
          ? "Setup script failed"
          : "Connection lost, click Run setup to try again"

  return (
    <SetupLogPanel
      state={state}
      statusLabel={statusLabel}
      output={output}
      connectionMessage={connectionMessage}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
      logId={logId}
      logRef={logRef}
    />
  )
}
