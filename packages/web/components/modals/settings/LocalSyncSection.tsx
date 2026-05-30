"use client"

import { useCallback, useEffect, useState } from "react"
import { FolderSync, Folder } from "lucide-react"
import { SettingsRow, MobileSectionHeader } from "./shared"
import { useElectron } from "@/lib/hooks/useElectron"

interface LocalSyncSectionProps {
  isMobile: boolean
}

/**
 * Desktop-only "Local Sync" settings: the root folder where Backgrounder
 * mirrors repositories on this computer for local testing. The chosen folder is
 * persisted per-installation by the Electron main process (never in the cloud).
 * Renders nothing in the web app.
 */
export function LocalSyncSection({ isMobile }: LocalSyncSectionProps) {
  const { isDesktopApp, api } = useElectron()
  const [rootDirectory, setRootDirectory] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktopApp || !api) return
    let cancelled = false
    void api.getGitSyncSettings().then((s) => {
      if (!cancelled) setRootDirectory(s.rootDirectory)
    })
    return () => {
      cancelled = true
    }
  }, [isDesktopApp, api])

  const handleChoose = useCallback(async () => {
    if (!api) return
    const dir = await api.pickSyncDirectory()
    if (dir) setRootDirectory(dir)
  }, [api])

  if (!isDesktopApp || !api) return null

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={FolderSync} label="Local Sync" />}
      <SettingsRow
        label="Backgrounder folder"
        description="Where repositories are synced on this computer for local testing. Stored on this device only."
      >
        <div className="flex items-center gap-2">
          <span
            className="max-w-[16rem] truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
            title={rootDirectory ?? undefined}
          >
            {rootDirectory ?? "Loading…"}
          </span>
          <button
            type="button"
            onClick={handleChoose}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors cursor-pointer"
          >
            <Folder className="h-3.5 w-3.5" />
            Choose…
          </button>
        </div>
      </SettingsRow>
    </div>
  )
}
