"use client"

import { useState, useRef, useEffect } from "react"
import { X, Loader2, File as FileIcon } from "lucide-react"
import {
  getFileType,
  formatFileSize,
  ImageFullPreview,
  PdfFullPreview,
  HighlightedCode,
} from "@/lib/file-preview"
import { cn } from "@/lib/utils"
import type { PendingFile } from "@/lib/types"

interface FilePreviewModalProps {
  file: PendingFile
  fileContent?: string
  onClose: () => void
  onRemove: () => void
  isMobile?: boolean
}

export function FilePreviewModal({ file, fileContent, onClose, onRemove, isMobile }: FilePreviewModalProps) {
  const fileType = getFileType(file.file)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fileType === 'image' || fileType === 'pdf') {
      const url = URL.createObjectURL(file.file)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [file.file, fileType])

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        // Close when clicking outside the modal content
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={modalRef}
        className={cn(
          "relative bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col",
          isMobile
            ? "w-[calc(100%-2rem)] max-w-full max-h-[85vh] mx-4"
            : "w-[min(90vw,56rem)] max-h-[85vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium truncate">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              ({formatFileSize(file.size)})
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              title="Close preview (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-auto">
          {fileType === 'image' && previewUrl && (
            <ImageFullPreview src={previewUrl} alt={file.name} />
          )}

          {fileType === 'pdf' && previewUrl && (
            <PdfFullPreview src={previewUrl} title={file.name} />
          )}

          {(fileType === 'text' || fileType === 'code') && (
            <div className="p-4">
              {fileContent ? (
                <HighlightedCode
                  code={fileContent}
                  filename={file.name}
                  maxHeight="65vh"
                  className="bg-muted/30 rounded-md"
                />
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading content...
                </div>
              )}
            </div>
          )}

          {fileType === 'other' && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileIcon className="h-16 w-16 mb-4" />
              <p className="text-sm">Preview not available for this file type</p>
              <p className="text-xs mt-1">{file.file.type || 'Unknown type'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
