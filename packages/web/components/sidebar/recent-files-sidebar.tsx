"use client"

import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react"
import { cn } from "@/lib/shared/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Loader2, Terminal, SquareTerminal, Globe, ExternalLink, FileCode } from "lucide-react"
import { highlight } from "sugar-high"

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

const PREVIEW_LINES = 30

interface DevServer {
  port: number
  url: string
}

interface TerminalLine {
  type: "input" | "output" | "error"
  content: string
}

interface RecentFilesSidebarProps {
  sandboxId: string | null | undefined
  repoPath: string
  /** Cache key to preserve state across branch switches */
  cacheKey: string
  /** Preview URL pattern from the branch (e.g., "https://{port}-xxx.daytonaproxy.net") */
  previewUrlPattern?: string
}

// Cache for files per sandbox/branch
const filesCache = new Map<string, { files: ModifiedFile[]; timestamp: number }>()
const CACHE_TTL = 30000 // 30 seconds

// Cache for file content
const contentCache = new Map<string, { content: FileContent; timestamp: number }>()
const CONTENT_CACHE_TTL = 60000 // 1 minute

// Cache for servers per sandbox
const serversCache = new Map<string, { ports: number[]; previewUrlPattern: string | null; timestamp: number }>()
const SERVERS_CACHE_TTL = 5000 // 5 seconds (check more frequently)

/**
 * Extract display info from file path
 * Returns short name (2-4 chars) and extension
 */
function getFileDisplayInfo(filePath: string): { shortName: string; ext: string; filename: string } {
  const parts = filePath.split("/")
  const filename = parts[parts.length - 1] || ""
  const dotIndex = filename.lastIndexOf(".")

  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : ""

  // Create a short name: up to 4 chars, smart truncation
  let shortName: string
  if (baseName.length <= 4) {
    shortName = baseName
  } else {
    // Try to find natural break points (camelCase, snake_case, kebab-case)
    const camelMatch = baseName.match(/^[a-z]+/i)
    if (camelMatch && camelMatch[0].length >= 2 && camelMatch[0].length <= 4) {
      shortName = camelMatch[0]
    } else {
      // Just take first 3-4 chars
      shortName = baseName.slice(0, 4)
    }
  }

  return { shortName: shortName.toLowerCase(), ext, filename }
}

/**
 * Get color for file extension
 */
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

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function highlightLines(code: string): string[] {
  return highlight(code).split("\n")
}

function HighlightedCode({ code }: { code: string }) {
  const lineCount = code.split("\n").length

  // Small files: render synchronously (no spinner flash)
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

  // Large files: defer to avoid blocking UI
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

/** Check if file is older than 5 minutes */
function isOldFile(modifiedAt: number): boolean {
  return Date.now() - modifiedAt > 5 * 60 * 1000
}

function FileIcon({ file, onClick, isPinned }: {
  file: ModifiedFile
  onClick: () => void
  isPinned: boolean
}) {
  const { shortName, ext } = getFileDisplayInfo(file.path)
  const extColor = getExtColor(ext)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-lg cursor-pointer",
        "bg-secondary",
        isPinned && "ring-2 ring-primary"
      )}
    >
      <span className="text-[9px] font-semibold font-mono leading-tight text-left">
        <span className="text-foreground">{shortName}</span>
        <br />
        <span className={extColor}>{ext}</span>
      </span>
    </button>
  )
}

function FilePreviewPopover({
  file,
  content,
  error,
  open,
  onOpenChange,
  onMouseEnter,
  onMouseLeave,
  onLoadFull,
  children,
}: {
  file: ModifiedFile
  content: FileContent | null
  error: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onLoadFull?: () => void
  children: React.ReactNode
}) {
  const { filename } = getFileDisplayInfo(file.path)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadFullTriggered = useRef(false)

  // Reset the guard when file changes or popover reopens
  useEffect(() => {
    loadFullTriggered.current = false
  }, [file.path, open])

  // Load full content when user scrolls near the bottom of a truncated preview
  const handleScroll = useCallback(() => {
    if (!content?.truncated || !scrollRef.current || !onLoadFull || loadFullTriggered.current) return
    const el = scrollRef.current
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      loadFullTriggered.current = true
      onLoadFull()
    }
  }, [content?.truncated, onLoadFull])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-[500px] max-w-[90vw] max-h-[80vh] p-0 flex flex-col overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs font-medium truncate">{filename}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
            <span>{formatSize(file.size)}</span>
            <span>{formatRelativeTime(file.modifiedAt)}</span>
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="overflow-auto min-h-0 flex-1" onScroll={handleScroll}>
          {error ? (
            <div className="flex items-center justify-center h-32 text-sm text-destructive">
              {error}
            </div>
          ) : content ? (
            <>
              <HighlightedCode code={content.content} />
              {content.truncated && (
                <div className="flex items-center justify-center py-2 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  Loading full file…
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Footer with full path */}
        <div className="border-t border-border px-3 py-1.5 bg-muted/30 shrink-0">
          <p className="font-mono text-[10px] text-foreground/70 truncate">{file.path}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ServerIcon({ onClick, isPinned, port }: {
  onClick: () => void
  isPinned: boolean
  port: number
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-lg transition-all cursor-pointer",
        "bg-secondary",
        isPinned && "ring-2 ring-primary"
      )}
    >
      <div className="flex flex-col items-center justify-center leading-none gap-0.5">
        <Globe className="h-3.5 w-3.5 text-foreground" />
        <span className="text-[8px] font-semibold text-foreground font-mono">
          {port}
        </span>
      </div>
    </button>
  )
}

function ServerPreviewPopover({
  server,
  open,
  onOpenChange,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  server: DevServer
  open: boolean
  onOpenChange: (open: boolean) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: React.ReactNode
}) {
  const [iframeLoading, setIframeLoading] = useState(true)
  const [iframeError, setIframeError] = useState(false)

  // Reset loading state when popover opens
  useEffect(() => {
    if (open) {
      setIframeLoading(true)
      setIframeError(false)
    }
  }, [open])

  const handleOpenExternal = () => {
    window.open(server.url, "_blank", "noopener,noreferrer")
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="w-[420px] h-[320px] p-0 overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <button
          onClick={handleOpenExternal}
          className="flex items-center gap-2 w-full border-b border-border px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
        >
          <Globe className="h-3.5 w-3.5 text-foreground shrink-0" />
          <span className="font-mono text-xs truncate flex-1 text-left">{server.url}</span>
        </button>

        {/* Iframe Container */}
        <div className="relative w-full h-[calc(100%-36px)] bg-white">
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
              src={server.url}
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
              title={`Preview of port ${server.port}`}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TerminalIcon({ onClick, isPinned }: {
  onClick: () => void
  isPinned: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-lg transition-all cursor-pointer",
        "bg-secondary",
        isPinned && "ring-2 ring-primary"
      )}
    >
      <Terminal className="h-4 w-4 text-foreground" />
    </button>
  )
}

function TerminalPopover({
  sandboxId,
  repoPath,
  open,
  onOpenChange,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  sandboxId: string
  repoPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: React.ReactNode
}) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [currentInput, setCurrentInput] = useState("")
  const [isExecuting, setIsExecuting] = useState(false)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentDir, setCurrentDir] = useState(repoPath)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Scroll to bottom when new lines are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  // Fetch current pwd after command execution
  const fetchPwd = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: currentDir,
          action: "execute-command",
          command: "pwd",
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.exitCode === 0 && data.output) {
          setCurrentDir(data.output.trim())
        }
      }
    } catch {
      // Ignore pwd fetch errors
    }
  }, [sandboxId, currentDir])

  const executeCommand = useCallback(async (command: string) => {
    if (!command.trim()) return

    // Add input line
    setLines(prev => [...prev, { type: "input", content: `$ ${command}` }])
    setCommandHistory(prev => [...prev, command])
    setHistoryIndex(-1)
    setCurrentInput("")
    setIsExecuting(true)

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: currentDir,
          action: "execute-command",
          command,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const output = data.output || ""
        const exitCode = data.exitCode

        if (output.trim()) {
          // Split output into lines
          const outputLines = output.split("\n")
          setLines(prev => [
            ...prev,
            ...outputLines.map((line: string) => ({
              type: exitCode === 0 ? "output" : "error" as const,
              content: line
            }))
          ])
        }

        if (exitCode !== 0) {
          setLines(prev => [...prev, { type: "error", content: `Exit code: ${exitCode}` }])
        }

        // Update pwd after command execution
        await fetchPwd()
      } else {
        setLines(prev => [...prev, { type: "error", content: "Failed to execute command" }])
      }
    } catch (err) {
      setLines(prev => [...prev, { type: "error", content: "Connection error" }])
    } finally {
      setIsExecuting(false)
      inputRef.current?.focus()
    }
  }, [sandboxId, currentDir, fetchPwd])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isExecuting) {
      executeCommand(currentInput)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex
        setHistoryIndex(newIndex)
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || "")
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || "")
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setCurrentInput("")
      }
    } else if (e.key === "c" && e.ctrlKey) {
      setCurrentInput("")
      setLines(prev => [...prev, { type: "input", content: `$ ${currentInput}^C` }])
    }
  }

  const handleContainerClick = () => {
    inputRef.current?.focus()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="w-[500px] h-[350px] p-0 overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <SquareTerminal className="h-3.5 w-3.5 text-foreground shrink-0" />
            <span className="font-mono text-xs truncate">{currentDir}</span>
          </div>
        </div>

        {/* Terminal Output */}
        <div
          ref={outputRef}
          onClick={handleContainerClick}
          className="h-[calc(100%-36px)] bg-[#1a1a1a] text-[#e0e0e0] font-mono text-xs p-2 overflow-auto cursor-text"
        >
          {lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                "whitespace-pre-wrap break-all leading-relaxed",
                line.type === "input" && "text-[#7cb7ff]",
                line.type === "error" && "text-[#ff6b6b]",
                line.type === "output" && "text-[#e0e0e0]"
              )}
            >
              {line.content || "\u00A0"}
            </div>
          ))}

          {/* Input Line */}
          <div className="flex items-center text-[#7cb7ff]">
            <span className="mr-1">$</span>
            <input
              ref={inputRef}
              type="text"
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isExecuting}
              className="flex-1 bg-transparent outline-none text-[#e0e0e0] caret-[#7cb7ff]"
              spellCheck={false}
              autoComplete="off"
            />
            {isExecuting && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-2" />
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RecentFilesSidebar({ sandboxId, repoPath, cacheKey, previewUrlPattern: propPreviewUrlPattern }: RecentFilesSidebarProps) {
  const [files, setFiles] = useState<ModifiedFile[]>([])
  const [pinnedFileIndex, setPinnedFileIndex] = useState<number | null>(null)
  const [hoveredFileIndex, setHoveredFileIndex] = useState<number | null>(null)
  const [fileContents, setFileContents] = useState<Map<string, FileContent>>(new Map())
  const [contentError, setContentError] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [servers, setServers] = useState<DevServer[]>([])
  const [previewUrlPattern, setPreviewUrlPattern] = useState<string | null>(propPreviewUrlPattern || null)

  // Server popover state
  const [pinnedServerPort, setPinnedServerPort] = useState<number | null>(null)
  const [hoveredServerPort, setHoveredServerPort] = useState<number | null>(null)

  // Terminal popover state
  const [terminalPinned, setTerminalPinned] = useState(false)
  const [terminalHovered, setTerminalHovered] = useState(false)

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const serverPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const serverHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const terminalHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch modified files
  const fetchModifiedFiles = useCallback(async () => {
    if (!sandboxId || !repoPath) return

    // Check cache first
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

  // Fetch running servers
  const fetchServers = useCallback(async () => {
    if (!sandboxId || !repoPath) return

    // Check cache first
    const cacheKeySrv = `servers-${sandboxId}`
    const cached = serversCache.get(cacheKeySrv)
    if (cached && Date.now() - cached.timestamp < SERVERS_CACHE_TTL) {
      const pattern = cached.previewUrlPattern || propPreviewUrlPattern
      if (pattern) {
        setServers(cached.ports.map(port => ({
          port,
          url: pattern.replace("{port}", String(port))
        })))
        setPreviewUrlPattern(pattern)
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
          setServers(ports.map(port => ({
            port,
            url: pattern.replace("{port}", String(port))
          })))
          setPreviewUrlPattern(pattern)
        } else {
          setServers([])
        }
      }
    } catch (err) {
      console.error("Failed to fetch servers:", err)
    }
  }, [sandboxId, repoPath, propPreviewUrlPattern])

  // Fetch file content (preview = first N lines, full = entire file)
  const fetchFileContent = useCallback(async (filePath: string, preview = false) => {
    if (!sandboxId || !repoPath) return

    // Check cache first — if we have full content cached, always use it
    const cached = contentCache.get(filePath)
    if (cached && Date.now() - cached.timestamp < CONTENT_CACHE_TTL) {
      // If requesting full but cache is truncated, refetch
      if (!preview || !cached.content.truncated) {
        setFileContents((prev) => new Map(prev).set(filePath, cached.content))
        return
      }
    }

    // For preview requests, don't show loading spinner — it should feel instant
    if (!preview) {
    }
    setContentError(null)

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "read-file",
          filePath,
          ...(preview ? { maxLines: PREVIEW_LINES } : {}),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setFileContents((prev) => new Map(prev).set(filePath, data))
        // Only cache full reads (not previews) in the long-lived cache
        if (!preview) {
          contentCache.set(filePath, { content: data, timestamp: Date.now() })
        }
      } else if (res.status === 413) {
        setContentError("File too large to preview")
      } else {
        setContentError("Failed to load file")
      }
    } catch (err) {
      console.error("Failed to fetch file content:", err)
      setContentError("Failed to load file")
    } finally {
    }
  }, [sandboxId, repoPath])

  // Load cached files immediately on mount or cache key change
  useEffect(() => {
    const cached = filesCache.get(cacheKey)
    if (cached) {
      setFiles(cached.files)
    } else {
      setFiles([])
    }
    // Clear open popovers on branch switch
    setPinnedFileIndex(null)
    setHoveredFileIndex(null)
    setPinnedServerPort(null)
    setHoveredServerPort(null)
    setTerminalPinned(false)
    setTerminalHovered(false)
  }, [cacheKey])

  // Poll for modified files
  useEffect(() => {
    if (!sandboxId || !repoPath) {
      setFiles([])
      return
    }

    // Initial fetch
    fetchModifiedFiles()

    // Poll every 5 seconds
    pollIntervalRef.current = setInterval(fetchModifiedFiles, 5000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [sandboxId, repoPath, fetchModifiedFiles])

  // Poll for running servers
  useEffect(() => {
    if (!sandboxId || !repoPath) {
      setServers([])
      return
    }

    // Initial fetch
    fetchServers()

    // Poll every 5 seconds
    serverPollIntervalRef.current = setInterval(fetchServers, 5000)

    return () => {
      if (serverPollIntervalRef.current) {
        clearInterval(serverPollIntervalRef.current)
      }
    }
  }, [sandboxId, repoPath, fetchServers])

  // ===== File Handlers =====
  const handleFileClick = useCallback((index: number) => {
    if (pinnedFileIndex === index) {
      setPinnedFileIndex(null)
    } else {
      setPinnedFileIndex(index)
      // Fetch full content when pinning
      const file = files[index]
      if (file) {
        const cached = fileContents.get(file.path)
        if (!cached || cached.truncated) {
          fetchFileContent(file.path, false)
        }
      }
    }
  }, [pinnedFileIndex, files, fileContents, fetchFileContent])

  const handleFileMouseEnter = useCallback((index: number, file: ModifiedFile) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    if (pinnedFileIndex !== null) return
    setHoveredFileIndex(index)
    if (!fileContents.has(file.path)) {
      fetchFileContent(file.path, true)
    }
  }, [pinnedFileIndex, fileContents, fetchFileContent])

  const handleFileMouseLeave = useCallback(() => {
    if (pinnedFileIndex !== null) return
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredFileIndex(null)
      setExpandedFiles(new Set())
    }, 200)
  }, [pinnedFileIndex])

  const handleFilePopoverMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const handleFileOpenChange = useCallback((index: number, open: boolean) => {
    if (!open) {
      if (pinnedFileIndex === index) {
        setPinnedFileIndex(null)
      }
      if (hoveredFileIndex === index) {
        setHoveredFileIndex(null)
      }
    }
  }, [pinnedFileIndex, hoveredFileIndex])

  // ===== Server Handlers =====
  const handleServerClick = useCallback((port: number) => {
    if (pinnedServerPort === port) {
      setPinnedServerPort(null)
    } else {
      setPinnedServerPort(port)
    }
  }, [pinnedServerPort])

  const handleServerMouseEnter = useCallback((port: number) => {
    if (serverHoverTimeoutRef.current) {
      clearTimeout(serverHoverTimeoutRef.current)
      serverHoverTimeoutRef.current = null
    }
    if (pinnedServerPort !== null) return
    setHoveredServerPort(port)
  }, [pinnedServerPort])

  const handleServerMouseLeave = useCallback(() => {
    if (pinnedServerPort !== null) return
    serverHoverTimeoutRef.current = setTimeout(() => {
      setHoveredServerPort(null)
    }, 200)
  }, [pinnedServerPort])

  const handleServerPopoverMouseEnter = useCallback(() => {
    if (serverHoverTimeoutRef.current) {
      clearTimeout(serverHoverTimeoutRef.current)
      serverHoverTimeoutRef.current = null
    }
  }, [])

  const handleServerOpenChange = useCallback((port: number, open: boolean) => {
    if (!open) {
      if (pinnedServerPort === port) {
        setPinnedServerPort(null)
      }
      if (hoveredServerPort === port) {
        setHoveredServerPort(null)
      }
    }
  }, [pinnedServerPort, hoveredServerPort])

  // ===== Terminal Handlers =====
  const handleTerminalClick = useCallback(() => {
    setTerminalPinned(prev => !prev)
  }, [])

  const handleTerminalMouseEnter = useCallback(() => {
    if (terminalHoverTimeoutRef.current) {
      clearTimeout(terminalHoverTimeoutRef.current)
      terminalHoverTimeoutRef.current = null
    }
    if (terminalPinned) return
    setTerminalHovered(true)
  }, [terminalPinned])

  const handleTerminalMouseLeave = useCallback(() => {
    if (terminalPinned) return
    terminalHoverTimeoutRef.current = setTimeout(() => {
      setTerminalHovered(false)
    }, 200)
  }, [terminalPinned])

  const handleTerminalPopoverMouseEnter = useCallback(() => {
    if (terminalHoverTimeoutRef.current) {
      clearTimeout(terminalHoverTimeoutRef.current)
      terminalHoverTimeoutRef.current = null
    }
  }, [])

  const handleTerminalOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setTerminalPinned(false)
      setTerminalHovered(false)
    }
  }, [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      if (serverHoverTimeoutRef.current) clearTimeout(serverHoverTimeoutRef.current)
      if (terminalHoverTimeoutRef.current) clearTimeout(terminalHoverTimeoutRef.current)
    }
  }, [])

  // Check if we have any content to show
  const hasContent = files.length > 0 || servers.length > 0 || sandboxId

  // Don't render if no content and no sandbox
  if (!hasContent) {
    return null
  }

  const terminalOpen = terminalPinned || terminalHovered

  return (
    <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-l border-border bg-sidebar py-3 overflow-y-auto">
      {/* Modified Files - Top */}
      {files.map((file, index) => {
        const isPinned = pinnedFileIndex === index
        const isHovered = hoveredFileIndex === index
        const isOpen = isPinned || isHovered
        const fullContent = fileContents.get(file.path) || null
        // On hover (not pinned/expanded), only render a preview to keep it snappy
        const needsTruncation = fullContent && !isPinned && !expandedFiles.has(file.path) && !fullContent.truncated
          && fullContent.content.split("\n").length > PREVIEW_LINES
        const content = needsTruncation
          ? { ...fullContent, content: fullContent.content.split("\n").slice(0, PREVIEW_LINES).join("\n"), truncated: true }
          : fullContent
        return (
          <FilePreviewPopover
            key={file.path}
            file={file}
            content={content}
            error={isOpen && !content ? contentError : null}
            open={isOpen}
            onOpenChange={(open) => handleFileOpenChange(index, open)}
            onMouseEnter={handleFilePopoverMouseEnter}
            onMouseLeave={handleFileMouseLeave}
            onLoadFull={() => {
              setExpandedFiles((prev) => new Set(prev).add(file.path))
              fetchFileContent(file.path, false)
            }}
          >
            <div
              onMouseEnter={() => handleFileMouseEnter(index, file)}
              onMouseLeave={handleFileMouseLeave}
            >
              <FileIcon
                file={file}
                onClick={() => handleFileClick(index)}
                isPinned={isPinned}
              />
            </div>
          </FilePreviewPopover>
        )
      })}

      {/* Spacer to push servers and terminal to bottom */}
      <div className="flex-1" />

      {/* Running Servers - Above Terminal */}
      {servers.map((server) => {
        const isPinned = pinnedServerPort === server.port
        const isHovered = hoveredServerPort === server.port
        const isOpen = isPinned || isHovered

        return (
          <ServerPreviewPopover
            key={server.port}
            server={server}
            open={isOpen}
            onOpenChange={(open) => handleServerOpenChange(server.port, open)}
            onMouseEnter={handleServerPopoverMouseEnter}
            onMouseLeave={handleServerMouseLeave}
          >
            <div
              onMouseEnter={() => handleServerMouseEnter(server.port)}
              onMouseLeave={handleServerMouseLeave}
            >
              <ServerIcon
                port={server.port}
                onClick={() => handleServerClick(server.port)}
                isPinned={isPinned}
              />
            </div>
          </ServerPreviewPopover>
        )
      })}

      {/* Terminal/SSH - Bottom */}
      {sandboxId && (
        <TerminalPopover
          sandboxId={sandboxId}
          repoPath={repoPath}
          open={terminalOpen}
          onOpenChange={handleTerminalOpenChange}
          onMouseEnter={handleTerminalPopoverMouseEnter}
          onMouseLeave={handleTerminalMouseLeave}
        >
          <div
            onMouseEnter={handleTerminalMouseEnter}
            onMouseLeave={handleTerminalMouseLeave}
          >
            <TerminalIcon
              onClick={handleTerminalClick}
              isPinned={terminalPinned}
            />
          </div>
        </TerminalPopover>
      )}
    </aside>
  )
}
