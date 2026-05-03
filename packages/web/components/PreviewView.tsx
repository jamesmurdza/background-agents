"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { RefreshCw, X, ExternalLink, ChevronsUpDown } from "lucide-react"
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
}: PreviewViewProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [scale, setScale] = useState(1)

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
  const repoRelativePath = item.type === "file"
    ? item.filePath.replace(new RegExp(`^${PATHS.PROJECT_DIR}/?`), "").replace(/^\/+/, "")
    : ""
  const fileGithubUrl =
    item.type === "file" && repo && branch
      ? `https://github.com/${repo}/blob/${branch}/${repoRelativePath}`
      : null

  const handleRefresh = () => {
    if (item.type === "terminal") {
      disposeTerminalSession(sandboxId)
    }
    setRefreshKey((k) => k + 1)
  }

  // Check if we have multiple items to show dropdown
  const hasMultipleItems = allItems && allItems.length > 0 && onSelectItem

  const Component = plugin.Component

  return (
    <div className={cn("flex flex-col min-h-0 bg-card", className)} style={style}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center gap-2 px-4 py-3">
          {/* Title with dropdown (when multiple items) or plain title */}
          {hasMultipleItems ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1.5 min-w-0 flex-1 text-left rounded-md px-1.5 py-0.5 -ml-1.5 hover:bg-accent transition-colors cursor-pointer"
                  title="Switch preview"
                  aria-label="Switch between open previews"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{getItemLabel(item)}</span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                {allItems.map((previewItem) => {
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
                        e.preventDefault()
                        onSelectItem(previewItem)
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {ItemIcon && <ItemIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        <span className="truncate text-xs">{getItemLabel(previewItem)}</span>
                      </div>
                      {onCloseItem && (
                        <button
                          className="flex h-4 w-4 items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive transition-colors shrink-0"
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
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
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

          {/* External link button - for files with GitHub URL */}
          {fileGithubUrl && (
            <a
              href={fileGithubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              title="Open on GitHub"
              aria-label="Open file on GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
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

        {/* Body - render the plugin component */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Component
            key={`${plugin.id}-${refreshKey}`}
            item={item}
            sandboxId={sandboxId}
            scale={scale}
          />
        </div>
      </div>
    </div>
  )
}
