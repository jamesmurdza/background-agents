"use client"

import { useEffect, useState } from "react"
import { FileCode2, Loader2 } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { HighlightedCode, getFileTypeFromPath, ImageFullPreview, PdfFullPreview, isMarkdownPath, MarkdownPreview } from "@/lib/file-preview"

function FileViewerComponent({ item, sandboxId }: PanelProps) {
  const [content, setContent] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const filePath = item.type === "file" ? item.filePath : ""
  const fileType = getFileTypeFromPath(filePath)

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

      try {
        if (fileType === "image" || fileType === "pdf") {
          // Fetch binary content
          const res = await fetch("/api/sandbox/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandboxId, action: "read-file-binary", filePath }),
          })

          if (cancelled) return

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
            body: JSON.stringify({ sandboxId, action: "read-file", filePath }),
          })

          if (cancelled) return

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
  }, [sandboxId, filePath, fileType])

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

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 p-4 text-sm text-destructive">
        <div>{error}</div>
      </div>
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
