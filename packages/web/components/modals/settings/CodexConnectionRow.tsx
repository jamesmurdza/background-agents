"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SettingsRow } from "./shared"

type Phase =
  // `context: "connect"` marks the wait that follows a Connect click, which is
  // long enough (a sandbox has to boot and run the CLI) to need its own copy.
  // The mount fetch and Disconnect also use this phase but resolve quickly, so
  // they stay bare.
  | { kind: "loading"; context?: "connect" }
  | { kind: "disconnected" }
  // `error` here is set only when a Disconnect click fails - the row must
  // keep showing Connected/Disconnect (not the generic error phase, which
  // renders a Connect button and would hide the Disconnect the user needs
  // to retry with).
  | { kind: "connected"; needsReconnect: boolean; error?: string }
  | { kind: "awaiting"; url: string; code: string; sessionId: string }
  | { kind: "error"; message: string }

/**
 * Copy shown for each `reason` code the device-auth API can return, both from
 * the initial POST (409 DEVICE_AUTH_UNAVAILABLE) and from a failed poll.
 *
 * `credential_lost` and `sandbox_unavailable` are not in the original task
 * brief - they were added after it was written. `credential_lost` in
 * particular describes a state where the user's browser approval SUCCEEDED
 * but we failed to persist the credential after retrying, so the copy must
 * say that plainly rather than reading like a generic failure.
 */
const REASON_COPY: Record<string, string> = {
  device_auth_disabled:
    "Device code login is off for your account. Turn it on in ChatGPT under Settings, Security, then Allow device code login, and try again.",
  admin_blocked:
    "Your ChatGPT workspace admin has blocked device code login. Use an OpenAI API key instead.",
  code_expired: "The code expired. Start again to get a new one.",
  refresh_failed: "We connected but couldn't verify the grant. Please try again.",
  credential_lost:
    "Signing in worked, but we couldn't save the connection. Nothing is connected yet - please try connecting again.",
  sandbox_unavailable: "The sign-in environment became unreachable. Please try again.",
  unknown_session: "This login is no longer active. Start again to get a new code.",
  unknown: "Codex couldn't start a device login. Use an OpenAI API key instead.",
}

/** Fallback for a poll failure whose reason isn't in REASON_COPY - unlike the
 * POST fallback, the login is already in progress here, so "couldn't start"
 * would be misleading. */
const POLL_FALLBACK = "Something went wrong finishing the sign-in. Please try again."

/**
 * Copy for the wait after a Connect click. A sandbox has to boot and run the
 * Codex CLI before there is a code to show, which is far longer than a bare
 * spinner can carry without reading as broken.
 */
const CONNECT_WAIT_COPY = "Setting up a secure sign-in. This takes a little while."
/** Shown once the wait has run long enough that the line above looks stuck. */
const CONNECT_WAIT_LONG_COPY = "Still setting things up. Hang tight."
/** How long to wait before swapping in the reassurance copy. */
const SLOW_CONNECT_NOTICE_MS = 12000

function reasonMessage(reason: unknown, fallback = REASON_COPY.unknown): string {
  if (typeof reason === "string" && REASON_COPY[reason]) return REASON_COPY[reason]
  return fallback
}

// The device code expires in 15 minutes; give the poll loop a hard ceiling
// slightly past that so a server bug that always returns "pending" can't
// leave an interval running forever.
const POLL_TIMEOUT_MS = 16 * 60 * 1000

/**
 * Connect / disconnect the ChatGPT subscription used by the Codex agent.
 *
 * Deliberately not a text field: the credential is established by an OAuth
 * device-code flow the server owns. Pasting a token from a laptop would share
 * a refresh lineage with that machine and eventually sign the user out of it.
 */
export function CodexConnectionRow({
  label,
  description,
}: {
  label: ReactNode
  description?: ReactNode
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Guards every `setState` that follows an `await` against firing after the
  // row has unmounted (e.g. the user closes Settings while a request is in
  // flight). A single ref covers the mount fetch, connect, and disconnect -
  // all three await a fetch before touching state.
  const mountedRef = useRef(true)
  // Flips on once a Connect wait has run long enough that a static line starts
  // to look frozen, so the copy can acknowledge it is still working.
  const [connectRunningLong, setConnectRunningLong] = useState(false)
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function clearSlowTimer() {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current)
      slowTimerRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    fetch("/api/user/codex-auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!mountedRef.current) return
        if (!d) return setPhase({ kind: "disconnected" })
        setPhase(
          d.connected
            ? { kind: "connected", needsReconnect: d.status === "needs_reconnect" }
            : { kind: "disconnected" }
        )
      })
      .catch(() => {
        if (mountedRef.current) setPhase({ kind: "disconnected" })
      })
    return () => {
      mountedRef.current = false
      // Unmount is a terminal state for whatever's in flight - always clear.
      clearPoll()
      clearSlowTimer()
    }
  }, [])

  async function connect() {
    clearPoll()
    clearSlowTimer()
    setConnectRunningLong(false)
    setPhase({ kind: "loading", context: "connect" })
    slowTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setConnectRunningLong(true)
    }, SLOW_CONNECT_NOTICE_MS)
    try {
      const res = await fetch("/api/user/codex-auth", { method: "POST" })
      const data = await res.json()
      // The POST can take ~30s (sandbox cold start, maxDuration 60) - the
      // user may have closed Settings before it resolves. Bail before
      // touching state or starting the poll interval; the mount effect's
      // cleanup already ran and cleared nothing because pollRef was still
      // null at that point.
      if (!mountedRef.current) return
      // The wait is over on every branch below, so retire the notice timer
      // here rather than repeating it in each one.
      clearSlowTimer()
      if (!res.ok) {
        setPhase({ kind: "error", message: reasonMessage(data.reason) })
        return
      }
      setPhase({ kind: "awaiting", url: data.url, code: data.code, sessionId: data.sessionId })

      const deadline = Date.now() + POLL_TIMEOUT_MS
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          clearPoll()
          setPhase({ kind: "error", message: REASON_COPY.code_expired })
          return
        }
        try {
          const p = await fetch(
            `/api/user/codex-auth?sessionId=${encodeURIComponent(data.sessionId)}`
          )
          if (!mountedRef.current) return
          if (!p.ok) return // transient server error - keep polling, don't tear down
          const status = await p.json()
          if (status.status === "connected") {
            clearPoll()
            setPhase({ kind: "connected", needsReconnect: false })
          } else if (status.status === "failed") {
            clearPoll()
            setPhase({ kind: "error", message: reasonMessage(status.reason, POLL_FALLBACK) })
          }
          // "pending" - keep polling.
        } catch {
          // Transient network hiccup - keep polling, don't tear down on one miss.
        }
      }, 2000)
    } catch {
      clearSlowTimer()
      if (mountedRef.current) setPhase({ kind: "error", message: REASON_COPY.unknown })
    }
  }

  async function disconnect() {
    // Preserve needsReconnect so a failed Disconnect restores exactly the
    // state the user was looking at, not a fresh "connected, all good" one.
    const prevNeedsReconnect = phase.kind === "connected" && phase.needsReconnect
    clearPoll()
    clearSlowTimer()
    setPhase({ kind: "loading" })
    try {
      const res = await fetch("/api/user/codex-auth", { method: "DELETE" })
      if (!mountedRef.current) return
      if (res.ok) {
        setPhase({ kind: "disconnected" })
      } else {
        // Only a 200 counts as disconnected. On failure, go back to the
        // connected state (not the generic error phase, which renders a
        // Connect button and hides Disconnect) with an inline error so the
        // user can see what happened and still has the Disconnect control
        // to retry with.
        setPhase({
          kind: "connected",
          needsReconnect: prevNeedsReconnect,
          error: "Couldn't disconnect. Please try again.",
        })
      }
    } catch {
      if (mountedRef.current) {
        setPhase({
          kind: "connected",
          needsReconnect: prevNeedsReconnect,
          error: "Couldn't disconnect. Please try again.",
        })
      }
    }
  }

  const isBusy = phase.kind === "loading"
  const isConnecting = phase.kind === "loading" && phase.context === "connect"
  const isAwaiting = phase.kind === "awaiting"
  const needsReconnect = phase.kind === "connected" && phase.needsReconnect
  const disconnectError = phase.kind === "connected" ? phase.error : undefined

  return (
    <SettingsRow label={label} description={description} stacked>
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs">
          {phase.kind === "connected" && (
            <span
              className={cn(
                "flex items-center gap-1",
                needsReconnect ? "text-amber-600" : "text-green-600 dark:text-green-400"
              )}
            >
              {!needsReconnect && <Check className="h-3 w-3" />}
              {needsReconnect ? "Connection expired" : "Connected"}
            </span>
          )}
          {phase.kind === "disconnected" && (
            <span className="text-muted-foreground">Not connected</span>
          )}
          {isConnecting && (
            <span className="text-muted-foreground">
              {connectRunningLong ? CONNECT_WAIT_LONG_COPY : CONNECT_WAIT_COPY}
            </span>
          )}
        </div>

        {phase.kind === "connected" ? (
          <div className="flex items-center gap-3">
            {needsReconnect && (
              <button
                type="button"
                onClick={connect}
                disabled={isBusy}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                Reconnect
              </button>
            )}
            <button
              type="button"
              onClick={disconnect}
              disabled={isBusy}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : !isAwaiting ? (
          <button
            type="button"
            onClick={connect}
            disabled={isBusy}
            className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
          >
            {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
            Connect
          </button>
        ) : null}
      </div>

      {needsReconnect && (
        <p className="mt-2 text-xs text-amber-600">
          This connection expired. Reconnect to keep using Codex on your plan.
        </p>
      )}

      {disconnectError && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{disconnectError}</p>
      )}

      {isAwaiting && (
        <div className="mt-2 p-3 rounded-md bg-muted/50 border border-border/50 text-xs space-y-2">
          <p>
            You started this login here. Open{" "}
            <a
              href={phase.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {phase.url}
            </a>{" "}
            and enter the code below. It expires in 15 minutes.
          </p>
          <div className="font-mono text-base tracking-widest">{phase.code}</div>
          <p className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for approval...
          </p>
        </div>
      )}

      {phase.kind === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{phase.message}</p>
      )}
    </SettingsRow>
  )
}
