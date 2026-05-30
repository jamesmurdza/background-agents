"use client"

import { useCallback, useEffect, useState } from "react"
import { GitBranch, Folder } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"
import { useElectron } from "@/lib/hooks/useElectron"

interface GitSectionProps {
  isMobile: boolean
  enablePrepushHooks: boolean
  setEnablePrepushHooks: (next: boolean) => void
}

/** Git settings: pre-push hook toggle, plus the desktop-only local sync folder. */
export function GitSection({
  isMobile,
  enablePrepushHooks,
  setEnablePrepushHooks,
}: GitSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={GitBranch} label="Git" />}
      <SettingsRow
        label="Enable pre-push hooks"
        description="Run pre-push hooks during autopush. When disabled, autopush uses --no-verify."
      >
        <ToggleSwitch checked={enablePrepushHooks} onChange={setEnablePrepushHooks} />
      </SettingsRow>
      <SyncFolderRow />
    </div>
  )
}

/**
 * Desktop-only: the root folder where repos are synced locally for testing.
 * Renders nothing in the web app. The chosen folder is persisted per-
 * installation by the Electron main process (not in the cloud).
 */
function SyncFolderRow() {
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
  )
}
