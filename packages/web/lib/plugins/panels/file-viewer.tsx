"use client"

import { useEffect, useMemo, useState } from "react"
import { FileCode2, Loader2, RefreshCw } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { HighlightedCode, getFileTypeFromPath, ImageFullPreview, PdfFullPreview, isMarkdownPath, MarkdownPreview } from "@/lib/file-preview"
import { cn } from "@/lib/utils"

/**
 * Centered status panel with a refresh button above the message. Used for the
 * stopped/expired sandbox states and for generic load errors.
 */
function PanelStatus({
  message,
  destructive,
  onRetry,
  actionTitle = "Refresh",
}: {
  message: string
  destructive?: boolean
  onRetry: () => void
  actionTitle?: string
}) {
  return (
    <div
      className={cn(
        "h-full flex flex-col items-center justify-center gap-3 p-4 text-center text-sm",
        destructive ? "text-destructive" : "text-muted-foreground"
      )}
    >
      <button
        type="button"
        onClick={onRetry}
        title={actionTitle}
        aria-label={actionTitle}
        className="flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent cursor-pointer"
      >
        <RefreshCw className="h-5 w-5" />
      </button>
      <div>{message}</div>
    </div>
  )
}

function FileViewerComponent({ item, sandboxId, messages, autoStart: autoStartProp }: PanelProps) {
  const [content, setContent] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // The sandbox is stopped and this passive read declined to boot it. Bumping
  // `resumeCount` (via the Resume button) re-runs the load with autoStart=true.
  const [needsResume, setNeedsResume] = useState(false)
  // The sandbox no longer exists (410). Distinct from `needsResume` (stopped)
  // so we can show an "expired" message instead.
  const [expired, setExpired] = useState(false)
  const [resumeCount, setResumeCount] = useState(0)

  const filePath = item.type === "file" ? item.filePath : ""
  const fileType = getFileTypeFromPath(filePath)

  // Re-fetch when the agent finishes editing this file. Each completed
  // Edit/Write tool call targeting this path (output attached = tool finished)
  // bumps the count, which re-runs the load effect below.
  const editSignal = useMemo(() => {
    if (!filePath || !messages) return 0
    let count = 0
    for (const message of messages) {
      for (const block of message.contentBlocks ?? []) {
        if (block.type !== "tool_calls") continue
        for (const tc of block.toolCalls) {
          if (
            (tc.tool === "Edit" || tc.tool === "Write") &&
            tc.filePath === filePath &&
            tc.output
          ) {
            count++
          }
        }
      }
    }
    return count
  }, [messages, filePath])

  useEffect(() => {
    if (!sandboxId) {
      setError("No sandbox.")
      setLoading(false)
      return
    }
    if (!filePath) {
      setError("No file path.")
      setLoading(false)
      return
    }

    let cancelled = false

    const loadFile = async () => {
      setLoading(true)
      setError(null)
      setNeedsResume(false)
      setExpired(false)

      // This is a passive panel read: don't boot a stopped sandbox unless the
      // user explicitly asked to (the refresh button bumps resumeCount, and the
      // top-bar refresh passes autoStartProp).
      const autoStart = resumeCount > 0 || Boolean(autoStartProp)

      try {
        if (fileType === "image" || fileType === "pdf") {
          // Fetch binary content
          const res = await fetch("/api/sandbox/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandboxId, action: "read-file-binary", filePath, autoStart }),
          })

          if (cancelled) return

          if (res.status === 409) {
            setNeedsResume(true)
            return
          }
          if (res.status === 410) {
            setExpired(true)
            return
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            setError(data.error || `Failed to load ${filePath}`)
            return
          }

          const blob = await res.blob()
          if (cancelled) return

          const url = URL.createObjectURL(blob)
          setBlobUrl(url)
        } else {
          // Fetch text content
          const res = await fetch("/api/sandbox/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandboxId, action: "read-file", filePath, autoStart }),
          })

          if (cancelled) return

          if (res.status === 409) {
            setNeedsResume(true)
            return
          }
          if (res.status === 410) {
            setExpired(true)
            return
          }
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            setError(data.error || `Failed to load ${filePath}`)
            setContent(null)
          } else {
            setContent(typeof data.content === "string" ? data.content : "")
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadFile()

    return () => {
      cancelled = true
      // Clean up blob URL
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [sandboxId, filePath, fileType, editSignal, resumeCount])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (needsResume) {
    return (
      <PanelStatus
        message="This sandbox is stopped."
        actionTitle="Start sandbox"
        onRetry={() => setResumeCount((c) => c + 1)}
      />
    )
  }

  if (expired) {
    return (
      <PanelStatus
        message="This sandbox expired."
        onRetry={() => setResumeCount((c) => c + 1)}
      />
    )
  }

  if (error) {
    return (
      <PanelStatus
        message={error}
        destructive
        onRetry={() => setResumeCount((c) => c + 1)}
      />
    )
  }

  // Image preview
  if (fileType === "image" && blobUrl) {
    return (
      <ImageFullPreview
        src={blobUrl}
        alt={filePath}
        className="h-full"
      />
    )
  }

  // PDF preview
  if (fileType === "pdf" && blobUrl) {
    return (
      <PdfFullPreview
        src={blobUrl}
        title={filePath}
        className="h-full"
        height="100%"
      />
    )
  }

  // Markdown preview with GitHub-style rendering
  if (isMarkdownPath(filePath)) {
    return (
      <MarkdownPreview
        content={content ?? ""}
        className="h-full"
        currentFilePath={filePath}
      />
    )
  }

  // Code/text preview with syntax highlighting
  return (
    <HighlightedCode
      code={content ?? ""}
      filename={filePath}
      className="h-full"
    />
  )
}

export const FileViewerPlugin: PanelPlugin = {
  id: "file-viewer",

  canHandle: (item: PreviewItem) => item.type === "file",

  getLabel: (item: PreviewItem) => {
    if (item.type === "file") {
      return item.filename
    }
    return "File"
  },

  getIcon: () => FileCode2,

  Component: FileViewerComponent,
}
