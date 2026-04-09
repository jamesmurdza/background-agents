"use client"

import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react"
import { cn } from "@/lib/shared/utils"
import { useUIStore, ContentPanelTab } from "@/lib/stores/ui-store"
import {
  X,
  Terminal,
  Plus,
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

interface TerminalLine {
  type: "input" | "output" | "error"
  content: string
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTerminal,
  onClose,
}: {
  tabs: ContentPanelTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onAddTerminal: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center border-b border-border bg-muted/30 shrink-0">
      {/* Tabs */}
      <div className="flex-1 flex items-center overflow-x-auto min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const { ext } = tab.type === "file" && tab.filePath
            ? getFileDisplayInfo(tab.filePath)
            : { ext: "" }

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-2 cursor-pointer border-r border-border/50 shrink-0",
                "hover:bg-accent/50 transition-colors",
                isActive && "bg-background border-b-2 border-b-primary"
              )}
            >
              {/* Tab Icon */}
              {tab.type === "file" && (
                <FileCode className={cn("h-3.5 w-3.5 shrink-0", getExtColor(ext))} />
              )}
              {tab.type === "terminal" && (
                <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {tab.type === "server" && (
                <Globe className="h-3.5 w-3.5 shrink-0 text-green-500" />
              )}

              {/* Tab Label */}
              <span className="text-xs font-medium truncate max-w-[120px]">
                {tab.filename}
              </span>

              {/* Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Add Terminal Button */}
      <button
        onClick={onAddTerminal}
        className="flex items-center justify-center h-full px-2 hover:bg-accent/50 transition-colors border-l border-border/50"
        title="New Terminal"
      >
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {/* Close Panel Button */}
      <button
        onClick={onClose}
        className="flex items-center justify-center h-full px-2 hover:bg-accent/50 transition-colors border-l border-border/50"
        title="Close Panel"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-mono text-xs font-medium truncate">{tab.filename}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
          <span>{formatSize(content.size)}</span>
          <span>{formatRelativeTime(content.modifiedAt)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        <HighlightedCode code={content.content} />
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 bg-muted/30 shrink-0">
        <p className="font-mono text-[10px] text-foreground/70 truncate">{tab.filePath}</p>
      </div>
    </div>
  )
}

// ============================================================================
// Terminal Tab Content Component
// ============================================================================

function TerminalTabContent({
  tab,
  sandboxId,
  repoPath,
}: {
  tab: ContentPanelTab
  sandboxId: string
  repoPath: string
}) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [currentInput, setCurrentInput] = useState("")
  const [isExecuting, setIsExecuting] = useState(false)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [currentDir, setCurrentDir] = useState(repoPath)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when new lines are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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

        await fetchPwd()
      } else {
        setLines(prev => [...prev, { type: "error", content: "Failed to execute command" }])
      }
    } catch {
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SquareTerminal className="h-3.5 w-3.5 text-foreground shrink-0" />
          <span className="font-mono text-xs truncate">{currentDir}</span>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={outputRef}
        onClick={handleContainerClick}
        className="flex-1 bg-[#1a1a1a] text-[#e0e0e0] font-mono text-xs p-2 overflow-auto cursor-text min-h-0"
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
    </div>
  )
}

// ============================================================================
// Server Tab Content Component
// ============================================================================

function ServerTabContent({ tab }: { tab: ContentPanelTab }) {
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
    contentPanelWidth,
    contentPanelTabs,
    contentPanelActiveTabId,
    setContentPanelWidth,
    closeContentPanel,
    addFileTab,
    addTerminalTab,
    addServerTab,
    removeServerTab,
    closeTab,
    setActiveTab,
    clearContentPanelTabs,
    openContentPanel,
  } = useUIStore()

  const [files, setFiles] = useState<ModifiedFile[]>([])
  const [previewUrlPattern, setPreviewUrlPattern] = useState<string | null>(propPreviewUrlPattern || null)
  const previousFilesRef = useRef<ModifiedFile[]>([])

  const isResizing = useRef(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const serverPollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // ===== Resize Logic =====
  const startResize = useCallback(() => {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, MIN_WIDTH), MAX_WIDTH)
      setContentPanelWidth(newWidth)
    }
    function onMouseUp() {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [setContentPanelWidth])

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

  // ===== Auto-Open for New Files =====
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    if (files.length === 0) return

    const previousPaths = new Set(previousFilesRef.current.map(f => f.path))
    const isInitialLoad = isInitialLoadRef.current

    // On initial load, add all recent files (not old). On subsequent polls, only add truly new files.
    const filesToAdd = isInitialLoad
      ? files.filter(f => !isOldFile(f.modifiedAt))
      : files.filter(f => !previousPaths.has(f.path) && !isOldFile(f.modifiedAt))

    if (filesToAdd.length > 0) {
      // Open panel if closed
      if (!contentPanelOpen) {
        openContentPanel()
      }

      // Add file tabs in background (makeActive = false, unless panel just opened)
      filesToAdd.forEach((file, index) => {
        const { filename } = getFileDisplayInfo(file.path)
        // Only make the first file active if panel was just opened (no existing tabs)
        const makeActive = !contentPanelOpen && index === 0 && contentPanelTabs.length === 0
        addFileTab(file.path, filename, makeActive)
      })
    }

    previousFilesRef.current = files
    isInitialLoadRef.current = false
  }, [files, contentPanelOpen, contentPanelTabs.length, openContentPanel, addFileTab])

  // ===== Clear tabs on branch switch =====
  useEffect(() => {
    clearContentPanelTabs()
    previousFilesRef.current = []
    isInitialLoadRef.current = true
  }, [cacheKey, clearContentPanelTabs])

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

  // ===== Render =====
  if (!contentPanelOpen) {
    return null
  }

  const activeTab = contentPanelTabs.find(t => t.id === contentPanelActiveTabId)

  return (
    <div
      className="flex h-full shrink-0 flex-col border-l border-border bg-card relative"
      style={{ width: contentPanelWidth }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
      />

      {/* Tab Bar */}
      <TabBar
        tabs={contentPanelTabs}
        activeTabId={contentPanelActiveTabId}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
        onAddTerminal={() => addTerminalTab(true)}
        onClose={closeContentPanel}
      />

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab ? (
          <>
            {activeTab.type === "file" && (
              <FileTabContent
                tab={activeTab}
                sandboxId={sandboxId}
                repoPath={repoPath}
              />
            )}
            {activeTab.type === "terminal" && (
              <TerminalTabContent
                tab={activeTab}
                sandboxId={sandboxId}
                repoPath={repoPath}
              />
            )}
            {activeTab.type === "server" && (
              <ServerTabContent tab={activeTab} />
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No tab selected
          </div>
        )}
      </div>
    </div>
  )
}
