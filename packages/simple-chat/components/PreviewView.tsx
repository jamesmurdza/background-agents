"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Terminal as XTermTerminal } from "xterm"
import type { FitAddon as XFitAddon } from "xterm-addon-fit"
import { useTheme } from "next-themes"
import hljs from "highlight.js/lib/common"
import { cn } from "@/lib/utils"
import {
  FileCode2,
  RefreshCw,
  X,
  TerminalSquare,
  Globe,
  Loader2,
  ExternalLink,
} from "lucide-react"

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

/**
 * The item currently shown in the preview pane. One-at-a-time by design:
 * closing the current item clears it; opening another replaces it.
 */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }

export interface PreviewViewProps {
  item: PreviewItem | null
  sandboxId: string | null
  /** Optional — when provided, file titles link to GitHub blob view for that branch. */
  repo?: string | null
  branch?: string | null
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
}

export function PreviewView({
  item,
  sandboxId,
  repo,
  branch,
  onClose,
  className,
  style,
}: PreviewViewProps) {
  const [refreshKey, setRefreshKey] = useState(0)

  const title =
    item?.type === "file"
      ? item.filename
      : item?.type === "terminal"
      ? "Terminal"
      : item?.type === "server"
      ? `Live preview · :${item.port}`
      : "Preview"

  const TitleIcon =
    item?.type === "terminal"
      ? TerminalSquare
      : item?.type === "server"
      ? Globe
      : FileCode2

  // When the titled item is a file and we have a repo/branch, let the user
  // click the title to jump to the file on GitHub in a new tab.
  const fileGithubUrl =
    item?.type === "file" && repo && branch
      ? `https://github.com/${repo}/blob/${branch}/${item.filePath.replace(/^\/+/, "")}`
      : null

  const handleRefresh = () => {
    if (item?.type === "terminal") {
      disposeTerminalSession(sandboxId)
    }
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className={cn("flex flex-col min-h-0 bg-card", className)} style={style}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center gap-2 px-4 py-3">
          <TitleIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {fileGithubUrl ? (
            <a
              href={fileGithubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group text-xs font-medium truncate flex-1 inline-flex items-center gap-1 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
              title="Open on GitHub"
            >
              <span className="truncate">{title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          ) : (
            <span className="text-xs font-medium truncate flex-1">{title}</span>
          )}

          <button
            onClick={handleRefresh}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Refresh"
            aria-label="Refresh preview"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Close"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {item?.type === "file" ? (
            <FileBody
              key={`${item.filePath}-${refreshKey}`}
              filePath={item.filePath}
              sandboxId={sandboxId}
            />
          ) : item?.type === "terminal" ? (
            <TerminalBody key={`${sandboxId}-${refreshKey}`} sandboxId={sandboxId} />
          ) : item?.type === "server" ? (
            <ServerBody key={`${item.url}-${refreshKey}`} url={item.url} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// File viewer
// ---------------------------------------------------------------------------

function FileBody({ filePath, sandboxId }: { filePath: string; sandboxId: string | null }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sandboxId) {
      setError("No sandbox.")
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/api/sandbox/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId, action: "read-file", filePath }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || `Failed to load ${filePath}`)
          setContent(null)
        } else {
          setContent(typeof data.content === "string" ? data.content : "")
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sandboxId, filePath])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 p-4 text-sm text-destructive">
        <div>{error}</div>
      </div>
    )
  }
  return <HighlightedCode code={content ?? ""} filePath={filePath} />
}

// Map file extensions to highlight.js language names. Unknown extensions fall
// back to auto-detection.
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", swift: "swift", scala: "scala",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", php: "php",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini",
  md: "markdown", markdown: "markdown",
  sql: "sql", dockerfile: "dockerfile",
  r: "r", lua: "lua", pl: "perl", dart: "dart",
  diff: "diff", patch: "diff",
}

function detectLang(filePath: string): string | null {
  const name = filePath.split("/").pop()?.toLowerCase() ?? ""
  if (name === "dockerfile") return "dockerfile"
  if (name === "makefile") return "makefile"
  const dot = name.lastIndexOf(".")
  if (dot < 0) return null
  return EXT_TO_LANG[name.slice(dot + 1)] ?? null
}

function HighlightedCode({ code, filePath }: { code: string; filePath: string }) {
  const lines = code.split("\n").map((_, i) => i)
  const lang = detectLang(filePath)
  let html: string
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } else {
      html = hljs.highlightAuto(code).value
    }
  } catch {
    html = escapeHtml(code)
  }
  const lineHtmls = html.split("\n")
  return (
    <div className="h-full overflow-auto hljs-scope">
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((i) => (
            <tr key={i} className="leading-5">
              <td className="select-none text-right text-muted-foreground/50 pr-3 pl-3 align-top w-1 whitespace-nowrap">
                {i + 1}
              </td>
              <td
                className="pr-3 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: lineHtmls[i] ?? "" }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// ---------------------------------------------------------------------------
// Terminal (xterm.js + sandbox PTY WebSocket)
// ---------------------------------------------------------------------------

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
    // Bring focus to the terminal so the user can start typing immediately.
    try { term.focus() } catch {}
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

function TerminalBody({ sandboxId }: { sandboxId: string | null }) {
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
      // and return focus to the terminal when the user re-opens it.
      requestAnimationFrame(() => {
        try { session!.fit?.fit() } catch {}
        try { session!.term?.focus() } catch {}
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

// ---------------------------------------------------------------------------
// Server (live preview)
// ---------------------------------------------------------------------------

function ServerBody({ url }: { url: string }) {
  return (
    <iframe
      src={url}
      className="h-full w-full border-0 bg-white"
      title="Live preview"
    />
  )
}
