"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import "xterm/css/xterm.css"
import { cn } from "@/lib/shared/utils"
import { useUIStore, ContentPanelTab } from "@/lib/stores/ui-store"
import { useTheme } from "next-themes"
import {
  X,
  Globe,
  ExternalLink,
  FileCode,
  Loader2,
  SquareTerminal,
} from "lucide-react"
import { highlight } from "sugar-high"

// ============================================================================
// Types
// ============================================================================

interface ModifiedFile {
  path: string
  modifiedAt: number
  size: number
}

interface FileContent {
  path: string
  content: string
  modifiedAt: number
  size: number
  truncated?: boolean
}

interface ContentPanelProps {
  sandboxId: string
  repoPath: string
  cacheKey: string
  previewUrlPattern?: string
}

// ============================================================================
// Constants
// ============================================================================

const MIN_WIDTH = 300
const MAX_WIDTH = 600
const PREVIEW_LINES = 30

// Cache for files per sandbox/branch
const filesCache = new Map<string, { files: ModifiedFile[]; timestamp: number }>()
const CACHE_TTL = 30000 // 30 seconds

// Cache for file content
const contentCache = new Map<string, { content: FileContent; timestamp: number }>()
const CONTENT_CACHE_TTL = 60000 // 1 minute

// Cache for servers per sandbox
const serversCache = new Map<string, { ports: number[]; previewUrlPattern: string | null; timestamp: number }>()
const SERVERS_CACHE_TTL = 5000 // 5 seconds

// ============================================================================
// Utility Functions
// ============================================================================

function getFileDisplayInfo(filePath: string): { shortName: string; ext: string; filename: string } {
  const parts = filePath.split("/")
  const filename = parts[parts.length - 1] || ""
  const dotIndex = filename.lastIndexOf(".")

  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : ""

  let shortName: string
  if (baseName.length <= 4) {
    shortName = baseName
  } else {
    const camelMatch = baseName.match(/^[a-z]+/i)
    if (camelMatch && camelMatch[0].length >= 2 && camelMatch[0].length <= 4) {
      shortName = camelMatch[0]
    } else {
      shortName = baseName.slice(0, 4)
    }
  }

  return { shortName: shortName.toLowerCase(), ext, filename }
}

function getExtColor(ext: string): string {
  const colors: Record<string, string> = {
    ".ts": "text-blue-600",
    ".tsx": "text-blue-500",
    ".js": "text-yellow-600",
    ".jsx": "text-yellow-500",
    ".json": "text-orange-600",
    ".py": "text-green-600",
    ".go": "text-cyan-600",
    ".rs": "text-orange-700",
    ".md": "text-gray-600",
    ".css": "text-pink-600",
    ".html": "text-red-600",
    ".txt": "text-gray-600",
    ".log": "text-amber-600",
  }
  return colors[ext] || "text-foreground"
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function isOldFile(modifiedAt: number): boolean {
  return Date.now() - modifiedAt > 5 * 60 * 1000
}

/** Check if file is a log file (in /tmp/logs or /tmp/claude) */
function isLogFile(filePath: string): boolean {
  return filePath.startsWith("/tmp/logs/") || filePath.startsWith("/tmp/claude/")
}

/** Check if a tab can be closed by the user */
function isTabClosable(tab: ContentPanelTab): boolean {
  // Server tabs and log files cannot be closed
  if (tab.type === "server") return false
  if (tab.type === "file" && tab.filePath && isLogFile(tab.filePath)) return false
  return true
}

function highlightLines(code: string): string[] {
  return highlight(code).split("\n")
}

// ============================================================================
// Code Highlighting Component
// ============================================================================

function HighlightedCode({ code }: { code: string }) {
  const lineCount = code.split("\n").length

  if (lineCount <= 100) {
    const lines = highlightLines(code)
    return (
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((lineHtml, i) => (
            <tr key={i} className="leading-5">
              <td className="select-none text-right text-muted-foreground/50 pr-3 pl-3 align-top w-1 whitespace-nowrap">{i + 1}</td>
              <td
                className="pr-3 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: lineHtml }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return <DeferredHighlightedCode code={code} />
}

function DeferredHighlightedCode({ code }: { code: string }) {
  const [lines, setLines] = useState<string[]>(() => highlightLines(code))
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setPending(true)
    const id = requestAnimationFrame(() => {
      setLines(highlightLines(code))
      setPending(false)
    })
    return () => cancelAnimationFrame(id)
  }, [code])

  return (
    <>
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((lineHtml, i) => (
            <tr key={i} className="leading-5">
              <td className="select-none text-right text-muted-foreground/50 pr-3 pl-3 align-top w-1 whitespace-nowrap">{i + 1}</td>
              <td
                className="pr-3 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: lineHtml }}
              />
            </tr>
          ))}
        </tbody>
      </table>
      {pending && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      )}
    </>
  )
}

// ============================================================================
// Tab Bar Component
// ============================================================================

/** Get the icon for a tab type */
function TabIcon({ tab, className }: { tab: ContentPanelTab; className?: string }) {
  const { ext } = tab.type === "file" && tab.filePath
    ? getFileDisplayInfo(tab.filePath)
    : { ext: "" }

  if (tab.type === "file") {
    return <FileCode className={cn("h-3 w-3", getExtColor(ext), className)} />
  }
  if (tab.type === "terminal") {
    return <SquareTerminal className={cn("h-3 w-3 text-muted-foreground", className)} />
  }
  if (tab.type === "server") {
    return <Globe className={cn("h-3 w-3 text-green-500", className)} />
  }
  return null
}

function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
}: {
  tabs: ContentPanelTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (activeTabRef.current && scrollRef.current) {
      const container = scrollRef.current
      const tab = activeTabRef.current
      const containerRect = container.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()

      if (tabRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - tabRect.left + 8
      } else if (tabRect.right > containerRect.right) {
        container.scrollLeft += tabRect.right - containerRect.right + 8
      }
    }
  }, [activeTabId])

  return (
    <div className="flex items-stretch border-b border-border bg-muted/30 h-8 shrink-0">
      {/* Scrollable tabs area */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none min-w-0"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const canClose = isTabClosable(tab)
          return (
            <div
              key={tab.id}
              ref={isActive ? activeTabRef : null}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelectTab(tab.id)
                }
              }}
              className={cn(
                "group relative flex items-center gap-1.5 px-3 shrink-0 text-xs transition-colors cursor-pointer",
                "hover:bg-accent/50",
                isActive
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}

              <TabIcon tab={tab} />
              <span className="truncate max-w-[100px]">{tab.filename}</span>

              {/* Close button - only for closable tabs */}
              {canClose && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  className={cn(
                    "ml-0.5 p-0.5 rounded hover:bg-foreground/10 transition-opacity cursor-pointer",
                    isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                  )}
                  aria-label={`Close ${tab.filename}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// File Tab Content Component
// ============================================================================

function FileTabContent({
  tab,
  sandboxId,
  repoPath,
}: {
  tab: ContentPanelTab
  sandboxId: string
  repoPath: string
}) {
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchContent = useCallback(async (preview = false) => {
    if (!tab.filePath) return

    // Check cache
    const cached = contentCache.get(tab.filePath)
    if (cached && Date.now() - cached.timestamp < CONTENT_CACHE_TTL) {
      if (!preview || !cached.content.truncated) {
        setContent(cached.content)
        setLoading(false)
        return
      }
    }

    setError(null)
    if (!preview) setLoading(true)

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "read-file",
          filePath: tab.filePath,
          ...(preview ? { maxLines: PREVIEW_LINES } : {}),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setContent(data)
        if (!preview) {
          contentCache.set(tab.filePath, { content: data, timestamp: Date.now() })
        }
      } else if (res.status === 413) {
        setError("File too large to preview")
      } else {
        setError("Failed to load file")
      }
    } catch {
      setError("Failed to load file")
    } finally {
      setLoading(false)
    }
  }, [tab.filePath, sandboxId, repoPath])

  useEffect(() => {
    fetchContent(false)
  }, [fetchContent])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!content) {
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        <HighlightedCode code={content.content} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 bg-muted/30 shrink-0">
        <p className="font-mono text-[10px] text-foreground/70 truncate">{tab.filePath}</p>
        <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeTime(content.modifiedAt)}</span>
      </div>
    </div>
  )
}

// ============================================================================
// Terminal Tab Content Component (WebSocket PTY)
// ============================================================================

// Terminal theme configurations
const TERMINAL_THEMES = {
  dark: {
    background: "#1a1a1a",
    foreground: "#e0e0e0",
    cursor: "#ffffff",
    cursorAccent: "#1a1a1a",
    selectionBackground: "rgba(255, 255, 255, 0.3)",
    selectionForeground: "#ffffff",
    black: "#000000",
    red: "#ff6b6b",
    green: "#69db7c",
    yellow: "#ffd43b",
    blue: "#74c0fc",
    magenta: "#da77f2",
    cyan: "#66d9e8",
    white: "#e0e0e0",
    brightBlack: "#666666",
    brightRed: "#ff8787",
    brightGreen: "#8ce99a",
    brightYellow: "#ffe066",
    brightBlue: "#91d0ff",
    brightMagenta: "#e599f7",
    brightCyan: "#99e9f2",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.2)",
    selectionForeground: "#000000",
    black: "#000000",
    red: "#c92a2a",
    green: "#2f9e44",
    yellow: "#e67700",
    blue: "#1971c2",
    magenta: "#9c36b5",
    cyan: "#0c8599",
    white: "#868e96",
    brightBlack: "#495057",
    brightRed: "#e03131",
    brightGreen: "#37b24d",
    brightYellow: "#f59f00",
    brightBlue: "#1c7ed6",
    brightMagenta: "#ae3ec9",
    brightCyan: "#1098ad",
    brightWhite: "#f8f9fa",
  },
}

function TerminalTabContent({
  tab,
  sandboxId,
}: {
  tab: ContentPanelTab
  sandboxId: string
  repoPath: string
}) {
  const { setTerminalWebsocketUrl } = useUIStore()
  const { resolvedTheme } = useTheme()
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "disconnected">("connecting")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const hasInitialized = useRef(false)
  const socketRef = useRef<WebSocket | null>(null)
  const terminalInstanceRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)

  // Get current theme colors
  const isDark = resolvedTheme === "dark"
  const terminalTheme = isDark ? TERMINAL_THEMES.dark : TERMINAL_THEMES.light

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.options.theme = terminalTheme
    }
  }, [terminalTheme])

  // Setup terminal when we have a websocketUrl
  const setupTerminal = useCallback(async (websocketUrl: string) => {
    // Already initialized
    if (terminalInstanceRef.current) return

    // Wait for the ref to be available (may take a render cycle)
    if (!terminalRef.current) {
      // Retry after a short delay
      setTimeout(() => setupTerminal(websocketUrl), 50)
      return
    }

    try {
      // Dynamically import xterm to avoid SSR issues
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
        import("xterm-addon-web-links"),
      ])

      // Create terminal instance with current theme
      const currentTheme = document.documentElement.classList.contains("dark")
        ? TERMINAL_THEMES.dark
        : TERMINAL_THEMES.light

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: currentTheme,
        allowProposedApi: true,
        scrollback: 10000,
      })

      terminalInstanceRef.current = terminal

      // Load addons
      const fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      terminal.loadAddon(fitAddon)

      const webLinksAddon = new WebLinksAddon()
      terminal.loadAddon(webLinksAddon)

      // Mount terminal
      terminal.open(terminalRef.current)

      // Initial fit
      setTimeout(() => {
        try {
          fitAddon.fit()
        } catch {
          // Ignore fit errors
        }
      }, 0)

      // Connect WebSocket
      console.log("[Terminal] Connecting to", websocketUrl)
      const socket = new WebSocket(websocketUrl)
      socketRef.current = socket

      socket.onopen = () => {
        console.log("[Terminal] WebSocket open")
        setStatus("connected")
        // Send initial resize
        const { cols, rows } = terminal
        socket.send(JSON.stringify({ type: "resize", cols, rows }))
      }

      socket.onerror = (event) => {
        console.error("[Terminal] WebSocket error", event)
        setStatus("error")
        setErrorMessage("Connection error")
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === "data" && message.payload) {
            terminal.write(message.payload)
          }
        } catch {
          // Ignore parse errors
        }
      }

      socket.onclose = (event) => {
        console.warn(
          `[Terminal] WebSocket closed code=${event.code} reason=${event.reason || "(none)"} wasClean=${event.wasClean}`
        )
        setStatus("disconnected")
        setErrorMessage(
          `closed code=${event.code}${event.reason ? ` reason=${event.reason}` : ""}`
        )
      }

      // Handle terminal input
      terminal.onData((data: string) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", payload: data }))
        }
      })

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit()
          if (socket.readyState === WebSocket.OPEN) {
            const { cols, rows } = terminal
            socket.send(JSON.stringify({ type: "resize", cols, rows }))
          }
        } catch {
          // Ignore resize errors
        }
      })
      resizeObserver.observe(terminalRef.current)

      return () => {
        resizeObserver.disconnect()
        socket.close()
        terminal.dispose()
      }
    } catch (err) {
      setStatus("error")
      setErrorMessage("Failed to load terminal")
      console.error("[Terminal] Error:", err)
    }
  }, [])

  // Initialize terminal connection
  useEffect(() => {
    if (hasInitialized.current) return
    hasInitialized.current = true

    // If we already have a websocketUrl, use it
    if (tab.websocketUrl) {
      setupTerminal(tab.websocketUrl)
      return
    }

    // Otherwise, set up the PTY server
    const setupPtyServer = async () => {
      try {
        const res = await fetch("/api/sandbox/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId,
            action: "setup",
          }),
        })

        if (res.ok) {
          const data = await res.json()
          if (data.status === "running" && data.websocketUrl) {
            // Store the websocketUrl in the tab
            setTerminalWebsocketUrl(tab.id, data.websocketUrl)
            // Setup terminal with the URL
            setupTerminal(data.websocketUrl)
          } else {
            setStatus("error")
            setErrorMessage(data.error || "Failed to start terminal server")
          }
        } else {
          const data = await res.json().catch(() => ({}))
          setStatus("error")
          setErrorMessage(data.error || "Failed to set up terminal")
        }
      } catch (err) {
        setStatus("error")
        setErrorMessage("Connection error")
        console.error("[Terminal] Setup error:", err)
      }
    }

    setupPtyServer()

    // Cleanup. Don't reset hasInitialized — under React StrictMode the cleanup
    // runs between the dev double-mount, and resetting the guard causes the
    // second effect run to fire setup a second time. A real unmount produces a
    // fresh component instance with a fresh ref next time, so leaving this set
    // is harmless.
    return () => {
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose()
        terminalInstanceRef.current = null
      }
      fitAddonRef.current = null
    }
  }, [tab.id, tab.websocketUrl, sandboxId, setTerminalWebsocketUrl, setupTerminal])

  // Always render the terminal div so xterm can mount to it
  // Show overlays for loading/error states
  return (
    <div
      className="flex-1 h-full w-full relative"
      style={{ backgroundColor: terminalTheme.background }}
    >
      {/* Terminal container - always rendered. Only set visibility:hidden during
          connecting/error so the loader/error overlay sits over an empty pane.
          Don't set visibility:visible explicitly: that would override the parent
          wrapper's visibility:hidden when this tab is inactive, causing two
          terminals to paint on top of each other. */}
      <div
        ref={terminalRef}
        className="h-full w-full"
        style={{
          padding: "4px",
          ...(status === "connecting" || status === "error"
            ? { visibility: "hidden" as const }
            : {}),
        }}
      />

      {/* Loading overlay */}
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Starting terminal...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-red-500">Terminal Error</span>
            <span className="text-xs text-muted-foreground">{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Disconnected overlay — wash the last terminal frame toward white and
          show the message centered on top. No border, no boxed container. */}
      {status === "disconnected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-yellow-600">Disconnected</span>
            <span className="text-xs text-muted-foreground">
              {errorMessage || "Terminal session ended"}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Server Tab Content Component
// ============================================================================

function ServerTabContent({ tab, isResizing }: { tab: ContentPanelTab; isResizing?: boolean }) {
  const [iframeLoading, setIframeLoading] = useState(true)
  const [iframeError, setIframeError] = useState(false)

  const handleOpenExternal = () => {
    if (tab.url) {
      window.open(tab.url, "_blank", "noopener,noreferrer")
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <button
        onClick={handleOpenExternal}
        className="flex items-center gap-2 w-full border-b border-border px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer shrink-0"
      >
        <Globe className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <span className="font-mono text-xs truncate flex-1 text-left">{tab.url}</span>
        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>

      {/* Iframe Container */}
      <div className="relative flex-1 bg-white min-h-0">
        {/* Overlay to capture mouse events during resize */}
        {isResizing && (
          <div className="absolute inset-0 z-10 cursor-col-resize" />
        )}
        {iframeLoading && !iframeError && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {iframeError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted gap-2">
            <p className="text-sm text-muted-foreground">Unable to load preview</p>
            <button
              onClick={handleOpenExternal}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Open in new tab <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <iframe
            src={tab.url}
            className="w-full h-full border-0"
            style={{
              transform: "scale(0.5)",
              transformOrigin: "top left",
              width: "200%",
              height: "200%"
            }}
            onLoad={() => setIframeLoading(false)}
            onError={() => {
              setIframeLoading(false)
              setIframeError(true)
            }}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={`Preview of port ${tab.port}`}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Content Panel Component
// ============================================================================

export function ContentPanel({
  sandboxId,
  repoPath,
  cacheKey,
  previewUrlPattern: propPreviewUrlPattern,
}: ContentPanelProps) {
  const {
    contentPanelOpen,
    contentPanelCollapsed,
    contentPanelWidth,
    contentPanelTabs,
    contentPanelActiveTabId,
    setContentPanelWidth,
    setContentPanelCollapsed,
    closeContentPanel,
    addFileTab,
    addTerminalTab,
    addServerTab,
    removeServerTab,
    closeTab,
    setActiveTab,
    switchContentPanelContext,
    openContentPanel,
  } = useUIStore()

  const [files, setFiles] = useState<ModifiedFile[]>([])
  const [previewUrlPattern, setPreviewUrlPattern] = useState<string | null>(propPreviewUrlPattern || null)
  const previousFilesRef = useRef<ModifiedFile[]>([])

  const [isResizing, setIsResizing] = useState(false)
  const [isAboutToCollapse, setIsAboutToCollapse] = useState(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const serverPollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // ===== Resize Logic =====
  const startResize = useCallback(() => {
    setIsResizing(true)
    setIsAboutToCollapse(false)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  // Threshold for collapsing - if dragged narrower than this, collapse
  const COLLAPSE_THRESHOLD = 100
  const COLLAPSED_WIDTH = 6

  useEffect(() => {
    if (!isResizing) return

    function onMouseMove(e: MouseEvent) {
      const rawWidth = window.innerWidth - e.clientX
      // If dragged past the collapse threshold, show collapse preview
      if (rawWidth < COLLAPSE_THRESHOLD) {
        setIsAboutToCollapse(true)
        return
      }
      setIsAboutToCollapse(false)
      // Uncollapse if we were collapsed and now dragging wider
      if (contentPanelCollapsed && rawWidth >= MIN_WIDTH) {
        setContentPanelCollapsed(false)
      }
      const newWidth = Math.min(Math.max(rawWidth, MIN_WIDTH), MAX_WIDTH)
      setContentPanelWidth(newWidth)
    }
    function onMouseUp(e: MouseEvent) {
      const rawWidth = window.innerWidth - e.clientX
      // If released past collapse threshold, collapse the panel
      if (rawWidth < COLLAPSE_THRESHOLD) {
        setContentPanelCollapsed(true)
      }
      setIsResizing(false)
      setIsAboutToCollapse(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [isResizing, setContentPanelWidth, setContentPanelCollapsed, contentPanelCollapsed])

  // ===== File Polling =====
  const fetchModifiedFiles = useCallback(async () => {
    if (!sandboxId || !repoPath) return

    const cached = filesCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setFiles(cached.files)
      return
    }

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "list-modified",
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const newFiles = data.files || []
        setFiles(newFiles)
        filesCache.set(cacheKey, { files: newFiles, timestamp: Date.now() })
      }
    } catch (err) {
      console.error("Failed to fetch modified files:", err)
    }
  }, [sandboxId, repoPath, cacheKey])

  // ===== Server Polling =====
  const fetchServers = useCallback(async () => {
    if (!sandboxId || !repoPath) return

    const cacheKeySrv = `servers-${sandboxId}`
    const cached = serversCache.get(cacheKeySrv)
    if (cached && Date.now() - cached.timestamp < SERVERS_CACHE_TTL) {
      const pattern = cached.previewUrlPattern || propPreviewUrlPattern
      if (pattern) {
        setPreviewUrlPattern(pattern)
        // Add/remove server tabs based on detected ports
        cached.ports.forEach(port => {
          addServerTab(port, pattern.replace("{port}", String(port)))
        })
      }
      return
    }

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "list-servers",
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const ports: number[] = data.ports || []
        const pattern = data.previewUrlPattern || propPreviewUrlPattern

        serversCache.set(cacheKeySrv, {
          ports,
          previewUrlPattern: pattern,
          timestamp: Date.now()
        })

        if (pattern) {
          setPreviewUrlPattern(pattern)
          // Add tabs for new servers
          ports.forEach(port => {
            addServerTab(port, pattern.replace("{port}", String(port)))
          })
          // Remove tabs for stopped servers
          const currentServerTabs = contentPanelTabs.filter(t => t.type === "server")
          currentServerTabs.forEach(tab => {
            if (tab.port && !ports.includes(tab.port)) {
              removeServerTab(tab.port)
            }
          })
        }
      }
    } catch (err) {
      console.error("Failed to fetch servers:", err)
    }
  }, [sandboxId, repoPath, propPreviewUrlPattern, addServerTab, removeServerTab, contentPanelTabs])

  // ===== Auto-Open for Log Files Only =====
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    const previousPaths = new Set(previousFilesRef.current.map(f => f.path))
    const currentPaths = new Set(files.map(f => f.path))
    const isInitialLoad = isInitialLoadRef.current

    // Close tabs for log files that have been deleted
    // Only do this after initial load (not on first render)
    if (!isInitialLoad) {
      const logTabsToClose = contentPanelTabs.filter(
        tab => tab.type === "file" && tab.filePath && isLogFile(tab.filePath) && !currentPaths.has(tab.filePath)
      )
      logTabsToClose.forEach(tab => closeTab(tab.id))
    }

    // Skip adding new tabs if no files
    if (files.length === 0) {
      previousFilesRef.current = files
      isInitialLoadRef.current = false
      return
    }

    // Only auto-open LOG files (in /tmp/logs or /tmp/claude), not regular code files
    // On initial load, add recent log files. On subsequent polls, only add truly new log files.
    const logFilesToAdd = isInitialLoad
      ? files.filter(f => isLogFile(f.path) && !isOldFile(f.modifiedAt))
      : files.filter(f => isLogFile(f.path) && !previousPaths.has(f.path) && !isOldFile(f.modifiedAt))

    if (logFilesToAdd.length > 0) {
      // Open panel if closed
      if (!contentPanelOpen) {
        openContentPanel()
      }

      // Add file tabs in background (makeActive = false, unless panel just opened)
      logFilesToAdd.forEach((file, index) => {
        const { filename } = getFileDisplayInfo(file.path)
        // Only make the first file active if panel was just opened (no existing tabs)
        const makeActive = !contentPanelOpen && index === 0 && contentPanelTabs.length === 0
        addFileTab(file.path, filename, makeActive)
      })
    }

    previousFilesRef.current = files
    isInitialLoadRef.current = false
  }, [files, contentPanelOpen, contentPanelTabs, openContentPanel, addFileTab, closeTab])

  // ===== Swap tab context on branch/repo switch =====
  // Snapshots the current tabs under the previous cacheKey and restores
  // whatever was last open under the new cacheKey, so coming back to a
  // branch shows the same tabs you left there.
  useEffect(() => {
    switchContentPanelContext(cacheKey)
    previousFilesRef.current = []
    isInitialLoadRef.current = true
  }, [cacheKey, switchContentPanelContext])

  // ===== Start Polling =====
  useEffect(() => {
    if (!sandboxId || !repoPath) {
      setFiles([])
      return
    }

    fetchModifiedFiles()
    pollIntervalRef.current = setInterval(fetchModifiedFiles, 5000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [sandboxId, repoPath, fetchModifiedFiles])

  useEffect(() => {
    if (!sandboxId || !repoPath) return

    fetchServers()
    serverPollIntervalRef.current = setInterval(fetchServers, 5000)

    return () => {
      if (serverPollIntervalRef.current) {
        clearInterval(serverPollIntervalRef.current)
      }
    }
  }, [sandboxId, repoPath, fetchServers])

  // ===== Auto-close when all tabs are closed =====
  useEffect(() => {
    if (contentPanelOpen && contentPanelTabs.length === 0) {
      closeContentPanel()
    }
  }, [contentPanelOpen, contentPanelTabs.length, closeContentPanel])

  // ===== Render =====
  if (!contentPanelOpen) {
    return null
  }

  const activeTab = contentPanelTabs.find(t => t.id === contentPanelActiveTabId)

  // Collapsed state - show strip that can be dragged to expand
  if (contentPanelCollapsed) {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l border-border bg-muted/50 hover:bg-primary/20 cursor-col-resize transition-colors"
        style={{ width: COLLAPSED_WIDTH }}
        onMouseDown={startResize}
        onDoubleClick={() => setContentPanelCollapsed(false)}
        title="Double-click to expand"
      />
    )
  }

  // About to collapse - show preview of collapsed state
  if (isAboutToCollapse) {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l border-border bg-primary/20 cursor-col-resize transition-colors"
        style={{ width: COLLAPSED_WIDTH }}
      />
    )
  }

  return (
    <div
      className="flex h-full shrink-0 flex-col border-l border-border bg-card relative"
      style={{ width: contentPanelWidth }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setContentPanelCollapsed(true)}
        title="Double-click to collapse"
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-20"
      />

      {/* Tab Bar */}
      <TabBar
        tabs={contentPanelTabs}
        activeTabId={contentPanelActiveTabId}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
      />

      {/* Content Area. Terminal tabs are kept mounted across switches so each
          one keeps its own xterm, WebSocket and bash session — only their
          visibility toggles based on which tab is active. File and server
          tabs render on top via z-index and an opaque background, covering
          any hidden terminals beneath. */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {contentPanelTabs
          .filter((t) => t.type === "terminal")
          .map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ visibility: activeTab?.id === t.id ? "visible" : "hidden" }}
            >
              <TerminalTabContent
                tab={t}
                sandboxId={sandboxId}
                repoPath={repoPath}
              />
            </div>
          ))}

        {activeTab && activeTab.type !== "terminal" ? (
          <div className="relative z-10 h-full w-full bg-card">
            {activeTab.type === "file" && (
              <FileTabContent
                tab={activeTab}
                sandboxId={sandboxId}
                repoPath={repoPath}
              />
            )}
            {activeTab.type === "server" && (
              <ServerTabContent tab={activeTab} isResizing={isResizing} />
            )}
          </div>
        ) : !activeTab ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No tab selected
          </div>
        ) : null}
      </div>
    </div>
  )
}
