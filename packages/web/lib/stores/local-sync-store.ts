"use client"

/**
 * Local-sync store — desktop-only client state for the "Backgrounder folder"
 * feature. Tracks the per-repo sync status that drives the folder button in the
 * chat header. Updated from Electron `sync-status` / `sync-error` IPC events by
 * the LocalSyncManager. No-op for the web app (the manager never runs there).
 */

import { create } from "zustand"
import type { RepoSyncState } from "@/lib/hooks/useElectron"

export interface RepoStatus {
  state: RepoSyncState
  /** Last error message (e.g. divergence). Shown on the button; cleared on a fresh op. */
  error?: string
}

interface LocalSyncStore {
  statuses: Record<string, RepoStatus>
  /** Replace a repo's sync state. Clears any prior error unless the state itself is "error". */
  setStatus: (repo: string, state: RepoSyncState, message?: string) => void
  /** Attach an error message to a repo without changing its current state. */
  setError: (repo: string, message: string) => void
}

export const useLocalSyncStore = create<LocalSyncStore>((set) => ({
  statuses: {},
  setStatus: (repo, state, message) =>
    set((s) => ({
      statuses: {
        ...s.statuses,
        [repo]: { state, error: state === "error" ? message : undefined },
      },
    })),
  setError: (repo, message) =>
    set((s) => ({
      statuses: {
        ...s.statuses,
        [repo]: { state: s.statuses[repo]?.state ?? "ready", error: message },
      },
    })),
}))
