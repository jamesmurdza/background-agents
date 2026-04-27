"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { RefreshCw, X, ExternalLink } from "lucide-react"
import { PATHS } from "@upstream/common"
import { getPanelPlugin } from "@/lib/plugins/registry"
import { disposeTerminalSession } from "@/lib/plugins/panels/terminal"

// Re-export types from plugins for backwards compatibility
export type { PreviewItem } from "@/lib/plugins/types"

export interface PreviewViewProps {
  item: import("@/lib/plugins/types").PreviewItem | null
  sandboxId: string | null
  /** Optional — when provided, file titles link to GitHub blob view for that branch. */
  repo?: string | null
  branch?: string | null
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
}

export function PreviewView({
  item,
  sandboxId,
  repo,
  branch,
  onClose,
  className,
  style,
}: PreviewViewProps) {
  const [refreshKey, setRefreshKey] = useState(0)

  // Find the plugin that can handle this item
  const plugin = item ? getPanelPlugin(item) : null

  if (!item || !plugin) {
    return null
  }

  const Icon = plugin.getIcon()
  const label = plugin.getLabel(item)

  // When the titled item is a file and we have a repo/branch, let the user
  // click the title to jump to the file on GitHub in a new tab.
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

  // Build the title node
  let titleNode: React.ReactNode
  if (item.type === "file" && fileGithubUrl) {
    titleNode = (
      <a
        href={fileGithubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group text-xs font-medium truncate flex-1 inline-flex items-center gap-1 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
        title="Open on GitHub"
      >
        <span className="truncate">{label}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
      </a>
    )
  } else if (item.type === "server") {
    titleNode = (
      <span className="text-xs font-medium truncate flex-1">
        Live preview · {label}
      </span>
    )
  } else {
    titleNode = (
      <span className="text-xs font-medium truncate flex-1">{label}</span>
    )
  }

  const Component = plugin.Component

  return (
    <div className={cn("flex flex-col min-h-0 bg-card", className)} style={style}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center gap-2 px-4 py-3">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {titleNode}

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
          />
        </div>
      </div>
    </div>
  )
}
