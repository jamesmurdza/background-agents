"use client"

/**
 * Local repo sync (Backgrounder folder) — renderer orchestration.
 *
 * The Electron main process is the git executor; this layer decides *when* to
 * call it (the renderer knows the chats / repos / branches). Everything here is
 * desktop-only: in the web app `isDesktopApp` is false and every effect is a
 * no-op, so web behaviour is unchanged.
 *
 * - `useLocalSyncManager()` is mounted once. It wires the IPC status/error
 *   listeners into the store, checks out the active chat's branch on focus
 *   change, and re-syncs a chat's branch when its agent turn completes.
 * - `useRepoFolderButton(repo)` powers the folder button in the chat header.
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useElectron } from "@/lib/hooks/useElectron"
import { useChatOptional } from "@/lib/contexts"
import { useLocalSyncStore, type RepoStatus } from "@/lib/stores/local-sync-store"
import { NEW_REPOSITORY } from "@/lib/types"
import type { Chat } from "@/lib/types"

/** A repo string that maps to a real GitHub repo (not a draft / new-repo chat). */
function isRealRepo(repo: string | undefined | null): repo is string {
  return !!repo && repo !== NEW_REPOSITORY
}

/** Unique, defined branches across the chats belonging to a repo. */
function agentBranchesForRepo(chats: Chat[], repo: string): string[] {
  const set = new Set<string>()
  for (const c of chats) {
    if (c.repo === repo && c.branch) set.add(c.branch)
  }
  return Array.from(set)
}

/**
 * Mounted once (see <LocalSyncManager/>). Owns the global sync side-effects.
 */
export function useLocalSyncManager(): void {
  const { isDesktopApp, api } = useElectron()
  const chat = useChatOptional()
  const setStatus = useLocalSyncStore((s) => s.setStatus)
  const setError = useLocalSyncStore((s) => s.setError)

  const chats = chat?.chats ?? []
  const currentChat = chat?.currentChat ?? null

  // Subscribe to main-process status/error events.
  useEffect(() => {
    if (!isDesktopApp || !api) return
    const offStatus = api.onSyncStatus(({ repo, status, message }) => {
      setStatus(repo, status, message)
    })
    const offError = api.onSyncError(({ repo, message }) => {
      setError(repo, message)
    })
    return () => {
      offStatus()
      offError()
    }
  }, [isDesktopApp, api, setStatus, setError])

  // On chat focus change, check out the active chat's branch locally (no-op in
  // main if the repo hasn't been opened/cloned yet).
  const lastActiveRef = useRef<string>("")
  useEffect(() => {
    if (!isDesktopApp || !api) return
    const repo = currentChat?.repo
    const branch = currentChat?.branch ?? null
    if (!isRealRepo(repo) || !branch) return
    const key = `${repo}|${branch}`
    if (key === lastActiveRef.current) return
    lastActiveRef.current = key
    void api.setActiveChat({ repo, branch })
  }, [isDesktopApp, api, currentChat?.repo, currentChat?.branch])

  // When a chat's agent turn finishes (status → "ready"), the server has just
  // auto-pushed; re-sync that branch locally (no-op in main if not cloned).
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!isDesktopApp || !api) return
    const prev = prevStatusRef.current
    for (const c of chats) {
      const before = prev.get(c.id)
      prev.set(c.id, c.status)
      if (before && before !== c.status && c.status === "ready") {
        if (isRealRepo(c.repo) && c.branch) {
          void api.syncBranch({ repo: c.repo, branch: c.branch })
        }
      }
    }
  }, [isDesktopApp, api, chats])
}

/**
 * Renderless component that runs the global sync side-effects. Mount once,
 * inside ChatProvider. Returns null in the web app (manager effects no-op).
 */
export function LocalSyncManager(): null {
  useLocalSyncManager()
  return null
}

export interface FolderButtonState {
  /** Whether the folder button should render at all (desktop + real repo). */
  visible: boolean
  status: RepoStatus["state"]
  error?: string
  busy: boolean
  onClick: () => void
}

/**
 * Powers the chat-header folder button for a given repo. First click on a
 * not-yet-cloned repo clones it (spinner) and opens the folder; later clicks
 * re-sync and re-open.
 */
export function useRepoFolderButton(repo: string | undefined | null): FolderButtonState {
  const { isDesktopApp, api } = useElectron()
  const chat = useChatOptional()
  const status = useLocalSyncStore((s) => (repo ? s.statuses[repo] : undefined))
  const setStatus = useLocalSyncStore((s) => s.setStatus)

  const visible = isDesktopApp && !!api && isRealRepo(repo)

  // Resolve the initial state from disk (cloned → ready, else idle) once.
  useEffect(() => {
    if (!visible || !api || !repo) return
    if (status) return
    let cancelled = false
    void api.getRepoSyncState(repo).then((res) => {
      if (cancelled) return
      setStatus(repo, res.cloned ? "ready" : "idle")
    })
    return () => {
      cancelled = true
    }
  }, [visible, api, repo, status, setStatus])

  const onClick = useCallback(() => {
    if (!api || !repo) return
    const chats = chat?.chats ?? []
    const branches = agentBranchesForRepo(chats, repo)
    const activeBranch = chat?.currentChat?.branch ?? null
    // Make sure the active chat's branch is in the set even if its chat row
    // isn't loaded into `chats` for some reason.
    if (activeBranch && !branches.includes(activeBranch)) branches.push(activeBranch)
    setStatus(repo, "cloning")
    void api.openRepoFolder({ repo, branches, activeBranch })
  }, [api, repo, chat, setStatus])

  const state = status?.state ?? "idle"
  const busy = state === "cloning" || state === "syncing"

  return { visible, status: state, error: status?.error, busy, onClick }
}
