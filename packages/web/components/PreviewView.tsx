"use client"

import { useState, useRef } from "react"
import { cn } from "@/lib/utils"
import { RefreshCw, X, ExternalLink, ChevronsUpDown, Download } from "lucide-react"
import { PATHS } from "@upstream/common"
import { getPanelPlugin } from "@/lib/plugins/registry"
import { disposeTerminalSession } from "@/lib/plugins/panels/terminal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PreviewItem } from "@/lib/plugins/types"

// Re-export types from plugins for backwards compatibility
export type { PreviewItem } from "@/lib/plugins/types"

export interface PreviewViewProps {
  item: PreviewItem | null
  sandboxId: string | null
  /** Optional — when provided, enables external link button for files. */
  repo?: string | null
  branch?: string | null
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  /** All open preview items (for tab switching dropdown) */
  allItems?: PreviewItem[]
  /** Called when user selects a different preview item from the dropdown */
  onSelectItem?: (item: PreviewItem) => void
  /** Called when user closes a specific item from the dropdown */
  onCloseItem?: (item: PreviewItem) => void
  /** All messages in the current chat, for plugins that need live content */
  messages?: import("@/lib/types").Message[]
}

/** Get a unique key for a preview item */
function getItemKey(item: PreviewItem): string {
  switch (item.type) {
    case "file":
      return `file:${item.filePath}`
    case "terminal":
      return `terminal:${item.id}`
    case "server":
      return `server:${item.port}`
    case "plan":
      return `plan:${item.messageId}`
  }
}

/** Get a display label for a preview item */
function getItemLabel(item: PreviewItem): string {
  const plugin = getPanelPlugin(item)
  if (!plugin) return "Preview"

  // For server previews, include "Live preview" prefix
  if (item.type === "server") {
    return `Live preview · ${plugin.getLabel(item)}`
  }
  return plugin.getLabel(item)
}

/** Shared styles for preview item rows (both trigger and menu items) */
const previewItemRowStyles = "flex items-center gap-1.5 px-1.5 py-1 text-left"

export function PreviewView({
  item,
  sandboxId,
  repo,
  branch,
  onClose,
  className,
  style,
  allItems,
  onSelectItem,
  onCloseItem,
  messages,
}: PreviewViewProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [scale, setScale] = useState(1)
  const [isDownloading, setIsDownloading] = useState(false)
  // Track when the dropdown just opened to ignore the initial pointerup
  const menuJustOpenedRef = useRef(false)

  // Download a file that's not in the repo
  const handleDownloadFile = async () => {
    if (item?.type !== "file" || !sandboxId || isDownloading) return

    setIsDownloading(true)
    try {
      const response = await fetch("/api/sandbox/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          action: "read-file",
          filePath: item.filePath,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to fetch file")
      }

      const data = await response.json()
      const blob = new Blob([data.content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = item.filePath.split("/").pop() || "download"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Failed to download file:", error)
    } finally {
      setIsDownloading(false)
    }
  }

  const scaleOptions = [
    { value: "1", label: "100%" },
    { value: "0.75", label: "75%" },
    { value: "0.5", label: "50%" },
    { value: "0.25", label: "25%" },
  ]

  // Find the plugin that can handle this item
  const plugin = item ? getPanelPlugin(item) : null

  if (!item || !plugin) {
    return null
  }

  const Icon = plugin.getIcon()

  // When the item is a file and we have a repo/branch, build the GitHub URL
  // File paths from sandbox are absolute (e.g., /home/daytona/project/src/index.ts)
  // so we need to strip the sandbox prefix to get the repo-relative path.
  // Only show the GitHub link if the file is actually inside the repo directory.
  const isFileInRepo = item.type === "file" && item.filePath.startsWith(PATHS.PROJECT_DIR)
  const repoRelativePath = item.type === "file" && isFileInRepo
    ? item.filePath.replace(new RegExp(`^${PATHS.PROJECT_DIR}/?`), "").replace(/^\/+/, "")
    : ""
  const fileGithubUrl =
    item.type === "file" && isFileInRepo && repo && branch
      ? `https://github.com/${repo}/blob/${branch}/${repoRelativePath}`
      : null

  // External URL for opening in new tab (files -> GitHub, servers -> preview URL)
  const externalUrl = fileGithubUrl ?? (item.type === "server" ? item.url : null)
  const externalLinkTitle = item.type === "server" ? "Open in new tab" : "Open on GitHub"

  const handleRefresh = () => {
    if (item.type === "terminal") {
      disposeTerminalSession(sandboxId)
    }
    setRefreshKey((k) => k + 1)
  }

  // Check if we have multiple items to show dropdown
  const hasMultipleItems = allItems && allItems.length > 0 && onSelectItem

  const Component = plugin.Component

  // Sort items so active item is first (for popup menu display)
  const sortedItems = hasMultipleItems
    ? [item, ...allItems.filter((i) => getItemKey(i) !== getItemKey(item))]
    : []

  return (
    <div className={cn("flex flex-col min-h-0 bg-card", className)} style={style}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center gap-2 px-4 py-3">
          {/* Title with popup menu (when multiple items) or plain title */}
          {hasMultipleItems ? (
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) {
                  menuJustOpenedRef.current = true
                  // Reset after a short delay to allow the initial pointerup to be ignored
                  setTimeout(() => {
                    menuJustOpenedRef.current = false
                  }, 150)
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    previewItemRowStyles,
                    "min-w-0 rounded-md hover:bg-accent transition-colors cursor-pointer"
                  )}
                  title="Switch preview"
                  aria-label="Switch between open previews"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{getItemLabel(item)}</span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0 ml-0.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={-32}
                alignOffset={-6}
              >
                {sortedItems.map((previewItem) => {
                  const itemPlugin = getPanelPlugin(previewItem)
                  const ItemIcon = itemPlugin?.getIcon()
                  const isActive = getItemKey(previewItem) === getItemKey(item)
                  return (
                    <DropdownMenuItem
                      key={getItemKey(previewItem)}
                      className={cn(
                        "flex items-center justify-between gap-2 cursor-pointer",
                        isActive && "bg-accent"
                      )}
                      onSelect={(e) => {
                        // Ignore selection if menu just opened (prevents immediate close from pointerup)
                        if (menuJustOpenedRef.current) {
                          e.preventDefault()
                          return
                        }
                        if (!isActive) {
                          onSelectItem(previewItem)
                        }
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {ItemIcon && <ItemIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        <span className="truncate text-xs font-medium">{getItemLabel(previewItem)}</span>
                      </div>
                      {onCloseItem && (
                        <button
                          className="flex h-4 w-4 items-center justify-center rounded hover:bg-accent transition-colors shrink-0 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            onCloseItem(previewItem)
                          }}
                          title="Close this preview"
                          aria-label={`Close ${getItemLabel(previewItem)}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className={cn(previewItemRowStyles, "min-w-0")}>
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">{getItemLabel(item)}</span>
            </div>
          )}

          {/* Spacer to push buttons to the right */}
          <div className="flex-1" />

          {/* Scale dropdown - only for server previews */}
          {item.type === "server" && (
            <Select
              value={String(scale)}
              onValueChange={(v) => setScale(parseFloat(v))}
            >
              <SelectTrigger
                className="h-6 w-[4.5rem] text-xs px-2 py-0 border-0 bg-transparent hover:bg-accent"
                title="Preview scale"
                aria-label="Adjust preview scale"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scaleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* External link button - for files in repo (GitHub) and servers (preview URL) */}
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              title={externalLinkTitle}
              aria-label={externalLinkTitle}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          {/* Download button - for files NOT in the repo */}
          {item.type === "file" && !isFileInRepo && (
            <button
              onClick={handleDownloadFile}
              disabled={isDownloading}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
              title="Download file"
              aria-label="Download file"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Refresh button - not shown for terminals */}
          {item.type !== "terminal" && (
            <button
              onClick={handleRefresh}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              title="Refresh"
              aria-label="Refresh preview"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Close"
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body - render the plugin component */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Component
            key={`${plugin.id}-${refreshKey}`}
            item={item}
            sandboxId={sandboxId}
            scale={scale}
            messages={messages}
          />
        </div>
      </div>
    </div>
  )
}
