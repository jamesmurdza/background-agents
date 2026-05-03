"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Terminal as XTermTerminal } from "xterm"
import type { FitAddon as XFitAddon } from "xterm-addon-fit"
import { useTheme } from "next-themes"
import { TerminalSquare, Loader2 } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"

// ---------------------------------------------------------------------------
// Terminal session cache (kept alive across close/reopen within a chat)
// ---------------------------------------------------------------------------

type TerminalSessionStatus = "connecting" | "connected" | "error" | "disconnected"

interface TerminalSession {
  /** Detached div that xterm renders into. Moved between containers on remount. */
  wrapper: HTMLDivElement
  term: XTermTerminal | null
  fit: XFitAddon | null
  socket: WebSocket | null
  status: TerminalSessionStatus
  errorMessage: string | null
  wsUrl: string | null
  listeners: Set<() => void>
  resizeObserver: ResizeObserver | null
}

const terminalSessions = new Map<string, TerminalSession>()

function notify(session: TerminalSession) {
  session.listeners.forEach((l) => l())
}

/**
 * Dispose a terminal session for a given sandbox ID.
 * Exported so PreviewView can call this on refresh.
 */
export function disposeTerminalSession(sandboxId: string | null) {
  if (!sandboxId) return
  const s = terminalSessions.get(sandboxId)
  if (!s) return
  try { s.resizeObserver?.disconnect() } catch {}
  try { s.socket?.close() } catch {}
  try { s.term?.dispose() } catch {}
  try { s.wrapper.remove() } catch {}
  terminalSessions.delete(sandboxId)
}

const TERMINAL_THEMES = {
  dark: {
    background: "#1a1a1a",
    foreground: "#e0e0e0",
    cursor: "#ffffff",
    cursorAccent: "#1a1a1a",
    selectionBackground: "rgba(255, 255, 255, 0.3)",
    selectionForeground: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.2)",
    selectionForeground: "#000000",
  },
}

async function setupAndConnect(
  session: TerminalSession,
  sandboxId: string,
  theme: typeof TERMINAL_THEMES.dark
) {
  try {
    const res = await fetch("/api/sandbox/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId, action: "setup" }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.status !== "running" || !data.websocketUrl) {
      session.status = "error"
      session.errorMessage = data.error || "Failed to start terminal server"
      notify(session)
      return
    }
    await connectTerminal(session, data.websocketUrl, theme)
  } catch (err) {
    session.status = "error"
    session.errorMessage = err instanceof Error ? err.message : "Connection error"
    notify(session)
  }
}

async function connectTerminal(
  session: TerminalSession,
  wsUrl: string,
  theme: typeof TERMINAL_THEMES.dark
) {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import("xterm"),
    import("xterm-addon-fit"),
    import("xterm-addon-web-links"),
  ])

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme,
    allowProposedApi: true,
    scrollback: 10000,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  session.term = term
  session.fit = fit
  term.open(session.wrapper)
  // Give the wrapper a layout pass before fitting.
  requestAnimationFrame(() => { try { fit.fit() } catch {} })

  const sock = new WebSocket(wsUrl)
  session.socket = sock
  session.wsUrl = wsUrl

  sock.onopen = () => {
    session.status = "connected"
    notify(session)
    try {
      const { cols, rows } = term
      sock.send(JSON.stringify({ type: "resize", cols, rows }))
    } catch {}
    // Focus on the next frame so the status change above has re-rendered
    // (removing the visibility:hidden on the host), and so we land *after*
    // the PaletteProvider's setTimeout(0) that refocuses the chat prompt
    // when a palette closes.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { try { term.focus() } catch {} })
    })
  }
  sock.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === "data" && msg.payload) term.write(msg.payload)
    } catch {}
  }
  sock.onerror = () => {
    session.status = "error"
    session.errorMessage = "Connection error"
    notify(session)
  }
  sock.onclose = (ev) => {
    session.status = "disconnected"
    session.errorMessage = `closed code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""}`
    notify(session)
  }
  term.onData((data) => {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "input", payload: data }))
    }
  })

  const ro = new ResizeObserver(() => {
    try {
      fit.fit()
      if (sock.readyState === WebSocket.OPEN) {
        const { cols, rows } = term
        sock.send(JSON.stringify({ type: "resize", cols, rows }))
      }
    } catch {}
  })
  ro.observe(session.wrapper)
  session.resizeObserver = ro
}

function TerminalComponent({ sandboxId }: PanelProps) {
  const { resolvedTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])
  const theme = resolvedTheme === "dark" ? TERMINAL_THEMES.dark : TERMINAL_THEMES.light

  useEffect(() => {
    if (!sandboxId || !hostRef.current) return
    const host = hostRef.current

    let session = terminalSessions.get(sandboxId)
    const isNew = !session

    if (!session) {
      const wrapper = document.createElement("div")
      wrapper.style.width = "100%"
      wrapper.style.height = "100%"
      session = {
        wrapper,
        term: null,
        fit: null,
        socket: null,
        status: "connecting",
        errorMessage: null,
        wsUrl: null,
        listeners: new Set(),
        resizeObserver: null,
      }
      terminalSessions.set(sandboxId, session)
    }

    session.listeners.add(rerender)
    host.appendChild(session.wrapper)

    if (isNew) {
      setupAndConnect(session, sandboxId, theme)
    } else {
      // Refit after reattach so xterm recomputes size against the new parent,
      // and return focus to the terminal when the user re-opens it. Double
      // rAF so we land after any setTimeout(0) that refocuses elsewhere
      // (e.g. the PaletteProvider's prompt refocus on palette close).
      requestAnimationFrame(() => {
        try { session!.fit?.fit() } catch {}
        requestAnimationFrame(() => { try { session!.term?.focus() } catch {} })
      })
    }

    return () => {
      session?.listeners.delete(rerender)
      if (session && session.wrapper.parentNode === host) {
        host.removeChild(session.wrapper)
      }
    }
    // `theme` change is intentionally not a dep — see the effect below which
    // updates the existing terminal's theme without recreating the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxId, rerender])

  // Sync theme updates to the cached term without disposing it.
  useEffect(() => {
    if (!sandboxId) return
    const session = terminalSessions.get(sandboxId)
    if (session?.term) session.term.options.theme = theme
  }, [sandboxId, theme])

  const session = sandboxId ? terminalSessions.get(sandboxId) : null
  const status = session?.status ?? "connecting"
  const errorMessage = session?.errorMessage ?? null

  return (
    <div className="flex-1 h-full w-full relative" style={{ backgroundColor: theme.background }}>
      <div
        ref={hostRef}
        className="h-full w-full"
        style={{
          padding: "6px 8px",
          ...(status === "connecting" || status === "error" ? { visibility: "hidden" as const } : {}),
        }}
      />
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Starting terminal…</span>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-red-500">Terminal error</span>
            <span className="text-xs text-muted-foreground">{errorMessage}</span>
          </div>
        </div>
      )}
      {status === "disconnected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-yellow-600">Disconnected</span>
            <span className="text-xs text-muted-foreground">{errorMessage || "Session ended"}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export const TerminalPlugin: PanelPlugin = {
  id: "terminal",

  canHandle: (item: PreviewItem) => item.type === "terminal",

  getLabel: (item) => {
    if (item.type !== "terminal") return "Terminal"
    const match = item.id.match(/-(\d+)$/)
    const num = match ? parseInt(match[1], 10) : 1
    return `Terminal ${num}`
  },

  getIcon: () => TerminalSquare,

  Component: TerminalComponent,
}
