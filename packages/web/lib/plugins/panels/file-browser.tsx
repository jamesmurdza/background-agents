"use client"

import { useState } from "react"
import { Folder, FileIcon, FolderOpen, ChevronRight } from "lucide-react"
import { PATHS } from "@background-agents/common"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import { PanelState } from "./PanelState"
import { useSandboxResource, assertSandboxOk } from "@/lib/hooks/useSandboxResource"
import { formatFileSize } from "@/lib/format"

interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

interface DirListing {
  path: string
  entries: DirEntry[]
}

async function loadDir(args: {
  sandboxId: string
  dirPath: string
  autoStart: boolean
  signal: AbortSignal
}): Promise<DirListing> {
  const { sandboxId, dirPath, autoStart, signal } = args
  const res = await fetch("/api/sandbox/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sandboxId, action: "list-dir", filePath: dirPath, autoStart }),
    signal,
  })
  await assertSandboxOk(res)
  const data = await res.json().catch(() => ({}) as { path?: unknown; entries?: unknown })
  return {
    path: typeof data.path === "string" ? data.path : dirPath,
    entries: Array.isArray(data.entries) ? (data.entries as DirEntry[]) : [],
  }
}

function FileBrowserComponent({ item, sandboxId, explicitStart, onRefresh, onOpenItem }: PanelProps) {
  const rootPath = item.type === "directory" ? item.dirPath : PATHS.SANDBOX_HOME
  // Local navigation state — starts at the item's directory, lets the user
  // browse into subdirectories without opening a new preview tab for each.
  const [currentPath, setCurrentPath] = useState(rootPath)

  const { status, data, error } = useSandboxResource<DirListing>({
    sandboxId,
    explicitStart,
    deps: [currentPath],
    load: ({ autoStart, signal }) =>
      loadDir({ sandboxId: sandboxId!, dirPath: currentPath, autoStart, signal }),
  })

  if (status === "loading") return <PanelState status="loading" />
  if (status === "stopped") return <PanelState status="stopped" onRefresh={onRefresh} />
  if (status === "expired") return <PanelState status="expired" onRefresh={onRefresh} />
  if (status === "error") {
    return <PanelState status="error" message={error ?? undefined} onRefresh={onRefresh} />
  }

  const path = data?.path ?? currentPath
  const entries = data?.entries ?? []
  const canGoUp = path !== "/" && path.length > 0

  const goUp = () => {
    const parent = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/")
    setCurrentPath(parent || "/")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2 text-xs text-muted-foreground font-mono truncate">
        <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{path}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {canGoUp && (
          <button
            type="button"
            onClick={goUp}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent cursor-pointer"
          >
            <ChevronRight className="h-4 w-4 flex-shrink-0 -rotate-90 text-muted-foreground" />
            <span className="text-muted-foreground">..</span>
          </button>
        )}
        {entries.length === 0 && !canGoUp && (
          <div className="p-4 text-center text-sm text-muted-foreground">Empty directory</div>
        )}
        {entries.map((entry) => (
          <button
            type="button"
            key={entry.name}
            onClick={() => {
              const entryPath = `${path.replace(/\/+$/, "")}/${entry.name}`
              if (entry.isDirectory) {
                setCurrentPath(entryPath)
              } else {
                onOpenItem?.({ type: "file", filePath: entryPath, filename: entry.name })
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent cursor-pointer"
          >
            {entry.isDirectory ? (
              <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <FileIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 truncate">{entry.name}</span>
            {!entry.isDirectory && (
              <span className="flex-shrink-0 text-xs text-muted-foreground">
                {formatFileSize(entry.size)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export const FileBrowserPlugin: PanelPlugin = {
  id: "file-browser",

  canHandle: (item: PreviewItem) => item.type === "directory",

  getLabel: () => "File browser",

  getIcon: () => Folder,

  Component: FileBrowserComponent,
}
