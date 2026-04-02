"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/shared/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Loader2 } from "lucide-react"

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
}

interface RecentFilesSidebarProps {
  sandboxId: string | null | undefined
  repoPath: string
  /** Cache key to preserve state across branch switches */
  cacheKey: string
}

// Cache for files per sandbox/branch
const filesCache = new Map<string, { files: ModifiedFile[]; timestamp: number }>()
const CACHE_TTL = 30000 // 30 seconds

// Cache for file content
const contentCache = new Map<string, { content: FileContent; timestamp: number }>()
const CONTENT_CACHE_TTL = 60000 // 1 minute

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
    ".ts": "text-blue-500",
    ".tsx": "text-blue-400",
    ".js": "text-yellow-500",
    ".jsx": "text-yellow-400",
    ".json": "text-orange-500",
    ".py": "text-green-500",
    ".go": "text-cyan-500",
    ".rs": "text-orange-600",
    ".md": "text-gray-500",
    ".css": "text-pink-500",
    ".html": "text-red-500",
    ".txt": "text-gray-400",
    ".log": "text-amber-500",
  }
  return colors[ext] || "text-muted-foreground"
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

/** Check if file is older than 5 minutes */
function isOldFile(modifiedAt: number): boolean {
  return Date.now() - modifiedAt > 5 * 60 * 1000
}

function FileIcon({ file, isLoading, onClick, isPinned }: {
  file: ModifiedFile
  isLoading: boolean
  onClick: () => void
  isPinned: boolean
}) {
  const { shortName, ext } = getFileDisplayInfo(file.path)
  const extColor = getExtColor(ext)
  const isOld = isOldFile(file.modifiedAt)

  // Adjust font size based on name length
  const nameSize = shortName.length <= 2 ? "text-[10px]" : shortName.length <= 3 ? "text-[9px]" : "text-[8px]"

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-md transition-all",
        "bg-secondary hover:bg-accent",
        isPinned && "ring-2 ring-primary",
        isOld && "opacity-40 hover:opacity-100"
      )}
    >
      <div className="flex flex-col items-center justify-center leading-none gap-0.5">
        <span className={cn(nameSize, "font-semibold text-foreground font-mono")}>{shortName}</span>
        <span className={cn("text-[7px] font-medium", extColor)}>{ext}</span>
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-md">
          <Loader2 className="h-3 w-3 animate-spin" />
        </div>
      )}
    </button>
  )
}

function FilePreviewPopover({
  file,
  content,
  isLoading,
  error,
  open,
  onOpenChange,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  file: ModifiedFile
  content: FileContent | null
  isLoading: boolean
  error: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: React.ReactNode
}) {
  const { filename, ext } = getFileDisplayInfo(file.path)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-[500px] max-w-[90vw] max-h-[80vh] p-0 overflow-hidden"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("text-xs font-medium", getExtColor(ext))}>{ext}</span>
            <span className="font-mono text-xs truncate">{filename}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
            <span>{formatSize(file.size)}</span>
            <span>{formatRelativeTime(file.modifiedAt)}</span>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto max-h-[calc(80vh-40px)]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-sm text-destructive">
              {error}
            </div>
          ) : content ? (
            <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all overflow-x-auto">
              {content.content}
            </pre>
          ) : null}
        </div>

        {/* Footer with full path */}
        <div className="border-t border-border px-3 py-1.5 bg-muted/30">
          <p className="font-mono text-[10px] text-muted-foreground truncate">{file.path}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RecentFilesSidebar({ sandboxId, repoPath, cacheKey }: RecentFilesSidebarProps) {
  const [files, setFiles] = useState<ModifiedFile[]>([])
  const [pinnedFileIndex, setPinnedFileIndex] = useState<number | null>(null)
  const [hoveredFileIndex, setHoveredFileIndex] = useState<number | null>(null)
  const [loadingContent, setLoadingContent] = useState<string | null>(null)
  const [fileContents, setFileContents] = useState<Map<string, FileContent>>(new Map())
  const [contentError, setContentError] = useState<string | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  // Fetch file content
  const fetchFileContent = useCallback(async (filePath: string) => {
    if (!sandboxId || !repoPath) return

    // Check cache first
    const cached = contentCache.get(filePath)
    if (cached && Date.now() - cached.timestamp < CONTENT_CACHE_TTL) {
      setFileContents((prev) => new Map(prev).set(filePath, cached.content))
      return
    }

    setLoadingContent(filePath)
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
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setFileContents((prev) => new Map(prev).set(filePath, data))
        contentCache.set(filePath, { content: data, timestamp: Date.now() })
      } else if (res.status === 413) {
        setContentError("File too large to preview")
      } else {
        setContentError("Failed to load file")
      }
    } catch (err) {
      console.error("Failed to fetch file content:", err)
      setContentError("Failed to load file")
    } finally {
      setLoadingContent(null)
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
    // Clear open popover on branch switch
    setPinnedFileIndex(null)
    setHoveredFileIndex(null)
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

  // Handle file icon click - pins the popover open
  const handleFileClick = useCallback((index: number) => {
    if (pinnedFileIndex === index) {
      // Unpin if already pinned
      setPinnedFileIndex(null)
    } else {
      // Pin this file
      setPinnedFileIndex(index)
    }
  }, [pinnedFileIndex])

  // Handle mouse enter - show popover on hover
  const handleMouseEnter = useCallback((index: number, file: ModifiedFile) => {
    // Clear any pending timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }

    // Don't override pinned state
    if (pinnedFileIndex !== null) return

    setHoveredFileIndex(index)

    // Fetch content if needed
    if (!fileContents.has(file.path)) {
      fetchFileContent(file.path)
    }
  }, [pinnedFileIndex, fileContents, fetchFileContent])

  // Handle mouse leave - hide popover after a short delay (unless pinned)
  const handleMouseLeave = useCallback(() => {
    // Don't close if pinned
    if (pinnedFileIndex !== null) return

    // Small delay to allow moving to the popover
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredFileIndex(null)
    }, 200)
  }, [pinnedFileIndex])

  // Handle popover content mouse enter - cancel the close timeout
  const handlePopoverMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  // Handle popover open change (for clicking outside when pinned)
  const handleOpenChange = useCallback((index: number, open: boolean) => {
    if (!open) {
      if (pinnedFileIndex === index) {
        setPinnedFileIndex(null)
      }
      if (hoveredFileIndex === index) {
        setHoveredFileIndex(null)
      }
    }
  }, [pinnedFileIndex, hoveredFileIndex])

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  // Don't render if no files
  if (files.length === 0) {
    return null
  }

  return (
    <aside className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1.5 border-l border-border bg-sidebar py-3 overflow-y-auto">
        {files.map((file, index) => {
          const isPinned = pinnedFileIndex === index
          const isHovered = hoveredFileIndex === index
          const isOpen = isPinned || isHovered
          const content = fileContents.get(file.path) || null
          const isLoadingThis = loadingContent === file.path

          return (
            <FilePreviewPopover
              key={file.path}
              file={file}
              content={content}
              isLoading={isLoadingThis}
              error={isOpen && !isLoadingThis && !content ? contentError : null}
              open={isOpen}
              onOpenChange={(open) => handleOpenChange(index, open)}
              onMouseEnter={handlePopoverMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <div
                onMouseEnter={() => handleMouseEnter(index, file)}
                onMouseLeave={handleMouseLeave}
              >
                <FileIcon
                  file={file}
                  isLoading={isLoadingThis}
                  onClick={() => handleFileClick(index)}
                  isPinned={isPinned}
                />
              </div>
            </FilePreviewPopover>
          )
        })}
    </aside>
  )
}
