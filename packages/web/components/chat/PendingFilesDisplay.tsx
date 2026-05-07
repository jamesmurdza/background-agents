"use client"

import { X, FileText, FileCode, FileImage, File as FileIcon } from "lucide-react"
import {
  formatFileSize,
  ImageThumbnail,
  PdfThumbnail,
  TextThumbnail,
} from "@/lib/file-preview"
import { cn } from "@/lib/utils"
import type { PendingFile } from "@/lib/types"

interface PendingFilesDisplayProps {
  pendingFiles: PendingFile[]
  fileContents: Map<string, string>
  getFileTypeForFile: (file: File) => "image" | "pdf" | "text" | "code" | "other"
  getFilePreviewUrl: (file: File) => string | null
  onRemoveFile: (id: string) => void
  onPreviewFile: (file: PendingFile) => void
  isMobile?: boolean
}

export function PendingFilesDisplay({
  pendingFiles,
  fileContents,
  getFileTypeForFile,
  getFilePreviewUrl,
  onRemoveFile,
  onPreviewFile,
  isMobile = false,
}: PendingFilesDisplayProps) {
  if (pendingFiles.length === 0) return null

  // Helper to get the icon component for a file type
  const getFileIcon = (file: File) => {
    const type = getFileTypeForFile(file)
    switch (type) {
      case "image": return FileImage
      case "code": return FileCode
      case "text": return FileText
      default: return FileIcon
    }
  }

  return (
    <div className={cn(
      "flex flex-wrap gap-2",
      isMobile ? "px-3 pt-3 pb-1" : "px-4 pt-3 pb-1"
    )}>
      {pendingFiles.map((pf) => {
        const fileType = getFileTypeForFile(pf.file)
        const IconComponent = getFileIcon(pf.file)
        const textContent = fileContents.get(pf.id)

        return (
          <div
            key={pf.id}
            className={cn(
              "relative group cursor-pointer rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors",
              isMobile ? "w-[120px] h-[120px]" : "w-[108px] h-[108px]"
            )}
            onClick={() => onPreviewFile(pf)}
            title={`${pf.name} (${formatFileSize(pf.size)})`}
          >
            {/* File preview content */}
            <div className="w-full h-full flex items-center justify-center overflow-hidden rounded-lg">
              {fileType === "image" ? (
                <ImageThumbnail file={pf.file} />
              ) : fileType === "pdf" ? (
                <PdfThumbnail file={pf.file} />
              ) : (fileType === "text" || fileType === "code") && textContent ? (
                <TextThumbnail content={textContent} filename={pf.name} />
              ) : (
                <div className="flex flex-col items-center justify-center text-muted-foreground p-1">
                  <IconComponent className={cn(isMobile ? "h-6 w-6" : "h-5 w-5")} />
                  <span className="text-[9px] mt-0.5 truncate w-full text-center px-1">
                    {pf.name.split(".").pop()?.toUpperCase() || "FILE"}
                  </span>
                </div>
              )}
            </div>

            {/* Remove button - top left corner, centered over corner */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemoveFile(pf.id)
              }}
              className={cn(
                "absolute flex items-center justify-center rounded-full bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground transition-colors shadow-sm cursor-pointer",
                isMobile ? "h-5 w-5 -top-2 -left-2" : "h-4 w-4 -top-1.5 -left-1.5"
              )}
              aria-label={`Remove ${pf.name}`}
            >
              <X className={cn(isMobile ? "h-3 w-3" : "h-2.5 w-2.5")} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
