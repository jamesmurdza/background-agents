"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { openOAuthPopup, pollUntilPopupCloses } from "@/lib/popup-poll"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { SettingsRow } from "./shared"

type Phase =
  | { kind: "loading" }
  | { kind: "connected"; error?: string }
  | { kind: "disconnected"; error?: string }
  | { kind: "awaiting" }

export interface McpConnectionRowConfig {
  /** qualifiedName, used only as a React key by the caller. */
  slug: string
  name: string
  description: string
  /** Bundled icon; vendor servers use their `iconUrl` instead. */
  icon?: ComponentType<{ className?: string }>
  iconUrl?: string
  /** GET -> { connected, authUrl? | installUrl? }. DELETE -> disconnect. */
  connectApi: string
  /** Popup window name, also the postMessage `source` the callback sends. */
  popupName: string
}

/**
 * Account-level connect/disconnect row for a first-party MCP integration
 * (Gmail, GitHub, Paddle). Mirrors the popup-based connect flow already used
 * per-chat in McpServersCombobox.tsx, but scoped to the account as a whole —
 * disconnecting here removes the credential and every attached
 * McpServerConnection row across all of the user's chats and scheduled jobs,
 * not just one chat.
 */
export function McpConnectionRow({ config }: { config: McpConnectionRowConfig }) {
  const { name, description, icon: Icon, iconUrl, connectApi, popupName } = config
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const mountedRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function refreshStatus(): Promise<{ connected: boolean; url?: string } | null> {
    try {
      const res = await fetch(connectApi)
      if (!res.ok) return null
      const data = (await res.json()) as {
        connected: boolean
        authUrl?: string
        installUrl?: string
      }
      return { connected: data.connected, url: data.installUrl ?? data.authUrl }
    } catch {
      return null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    refreshStatus().then((status) => {
      if (!mountedRef.current) return
      setPhase(status?.connected ? { kind: "connected" } : { kind: "disconnected" })
    })
    return () => {
      mountedRef.current = false
      clearPoll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setPhase({ kind: "loading" })
    const status = await refreshStatus()
    if (!mountedRef.current) return
    if (status?.connected) {
      setPhase({ kind: "connected" })
      return
    }
    if (!status?.url) {
      setPhase({ kind: "disconnected", error: `${name} is not configured on the server` })
      return
    }
    const popup = openOAuthPopup(status.url, popupName)
    if (!popup) {
      setPhase({ kind: "disconnected" })
      return
    }
    setPhase({ kind: "awaiting" })
    pollRef.current = pollUntilPopupCloses(
      popup,
      async () => {
        const finished = await refreshStatus()
        if (!mountedRef.current) return
        setPhase(
          finished?.connected
            ? { kind: "connected" }
            : { kind: "disconnected", error: `${name} wasn't connected. Please try again.` }
        )
      },
      { messageSource: popupName }
    )
  }

  async function disconnect() {
    setPhase({ kind: "loading" })
    try {
      const res = await fetch(connectApi, { method: "DELETE" })
      if (!mountedRef.current) return
      if (res.ok) {
        setPhase({ kind: "disconnected" })
      } else {
        setPhase({ kind: "connected", error: "Couldn't disconnect. Please try again." })
      }
    } catch {
      if (mountedRef.current) {
        setPhase({ kind: "connected", error: "Couldn't disconnect. Please try again." })
      }
    }
  }

  const isBusy = phase.kind === "loading"
  const isAwaiting = phase.kind === "awaiting"
  const error = phase.kind === "connected" || phase.kind === "disconnected" ? phase.error : undefined

  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2">
          {Icon ? (
            <Icon className="h-4 w-4 flex-shrink-0" />
          ) : iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl}
              alt=""
              className="h-4 w-4 flex-shrink-0"
              onError={(e) => { e.currentTarget.style.visibility = "hidden" }}
            />
          ) : null}
          {name}
        </span>
      }
      description={description}
      stacked
    >
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs">
          {phase.kind === "connected" && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
                "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400"
              )}
            >
              <Check className="h-3 w-3" />
              Connected
            </span>
          )}
          {phase.kind === "disconnected" && (
            <span className="text-muted-foreground">Not connected</span>
          )}
          {isAwaiting && <span className="text-muted-foreground">Waiting for approval...</span>}
        </div>

        {phase.kind === "connected" ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isBusy}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Disconnect
          </button>
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

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={disconnect}
        title={`Disconnect ${name}?`}
        description={`This removes ${name} from every chat and scheduled job it's attached to. You'll need to reconnect — and reauthorize — before using it again.`}
        confirmLabel="Disconnect"
        variant="destructive"
      />
    </SettingsRow>
  )
}
