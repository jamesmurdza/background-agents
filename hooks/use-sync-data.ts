import { useCallback, useRef } from "react"
import type { Branch } from "@/lib/types"
import type { TransformedRepo, DbMessage } from "@/lib/db-types"
import {
  updateBranchAcrossRepos,
  setBranchesInRepo,
} from "@/lib/state-utils"

// Sync data shape from the API
export interface SyncBranch {
  id: string
  name: string
  status: string
  baseBranch: string | null
  prUrl: string | null
  sandboxId: string | null
  lastMessageId: string | null
}

export interface SyncRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: SyncBranch[]
}

export interface SyncData {
  repos: SyncRepo[]
}

interface UseSyncDataOptions {
  setRepos: React.Dispatch<React.SetStateAction<TransformedRepo[]>>
  activeBranchIdRef: React.MutableRefObject<string | null>
  /** Ref to check if a message is currently being streamed - skip sync if so */
  streamingMessageIdRef?: React.MutableRefObject<string | null>
}

/**
 * Converts a SyncBranch to a Branch with default values
 */
function syncBranchToBranch(syncBranch: SyncBranch): Branch {
  return {
    id: syncBranch.id,
    name: syncBranch.name,
    status: syncBranch.status as Branch["status"],
    baseBranch: syncBranch.baseBranch || "main",
    prUrl: syncBranch.prUrl || undefined,
    sandboxId: syncBranch.sandboxId || undefined,
    messages: [],
  }
}

/**
 * Merges sync branch data into existing branch, preserving messages
 */
function mergeSyncBranchIntoExisting(
  existingBranch: Branch,
  syncBranch: SyncBranch
): Branch {
  return {
    ...existingBranch,
    status: syncBranch.status as Branch["status"],
    prUrl: syncBranch.prUrl || undefined,
    sandboxId: syncBranch.sandboxId || undefined,
  }
}

/**
 * Build branch list from sync data while preserving local-only branches
 * (e.g. branch with status CREATING not yet in server response).
 */
function mergeBranchesWithLocalOnly(
  existingBranches: Branch[],
  syncBranches: SyncBranch[]
): Branch[] {
  const syncIds = new Set(syncBranches.map((b) => b.id))
  const localOnly = existingBranches.filter((b) => !syncIds.has(b.id))
  const fromSync = syncBranches.map((syncBranch) => {
    const existing = existingBranches.find((b) => b.id === syncBranch.id)
    return existing
      ? mergeSyncBranchIntoExisting(existing, syncBranch)
      : syncBranchToBranch(syncBranch)
  })
  return [...fromSync, ...localOnly]
}

/**
 * Provides the sync data handler for cross-device sync
 * Detects changes from other devices and updates local state
 */
export function useSyncData({ setRepos, activeBranchIdRef, streamingMessageIdRef }: UseSyncDataOptions) {
  // Track last message IDs to detect new messages
  const lastMessageIdsRef = useRef<Map<string, string | null>>(new Map())

  const handleSyncData = useCallback((
    data: SyncData,
    lastData: SyncData | null
  ) => {
    // Skip first sync (just populate baseline)
    if (!lastData) {
      // Initialize message ID tracking
      for (const repo of data.repos) {
        for (const branch of repo.branches) {
          lastMessageIdsRef.current.set(branch.id, branch.lastMessageId)
        }
      }
      return
    }

    const lastRepoMap = new Map(lastData.repos.map((r) => [r.id, r]))
    const currentRepoMap = new Map(data.repos.map((r) => [r.id, r]))

    // Check for repo changes
    const reposChanged =
      data.repos.length !== lastData.repos.length ||
      data.repos.some((r) => !lastRepoMap.has(r.id)) ||
      lastData.repos.some((r) => !currentRepoMap.has(r.id))

    if (reposChanged) {
      // Repos added or removed - update the full list
      setRepos((prev) => {
        return data.repos.map((syncRepo) => {
          // Try to preserve existing local data (messages, etc)
          const existing = prev.find((r) => r.id === syncRepo.id)
          if (existing) {
            // Update branches from sync but keep local-only (e.g. CREATING) so they don't disappear mid-create
            return {
              ...existing,
              branches: mergeBranchesWithLocalOnly(existing.branches, syncRepo.branches),
            }
          }
          // New repo from sync
          return {
            id: syncRepo.id,
            name: syncRepo.name,
            owner: syncRepo.owner,
            avatar: syncRepo.avatar || "",
            defaultBranch: syncRepo.defaultBranch,
            branches: syncRepo.branches.map(syncBranchToBranch),
          }
        })
      })
    } else {
      // No repo-level changes, check for branch-level changes
      for (const syncRepo of data.repos) {
        const lastRepo = lastRepoMap.get(syncRepo.id)
        if (!lastRepo) continue

        const lastBranchMap = new Map(lastRepo.branches.map((b) => [b.id, b]))
        const currentBranchMap = new Map(syncRepo.branches.map((b) => [b.id, b]))

        // Check for branch additions/removals
        const branchesChanged =
          syncRepo.branches.length !== lastRepo.branches.length ||
          syncRepo.branches.some((b) => !lastBranchMap.has(b.id)) ||
          lastRepo.branches.some((b) => !currentBranchMap.has(b.id))

        if (branchesChanged) {
          // Update this repo's branches but keep local-only (e.g. CREATING) so they don't disappear mid-create
          setRepos((prev) => {
            const repo = prev.find((r) => r.id === syncRepo.id)
            if (!repo) return prev
            const merged = mergeBranchesWithLocalOnly(repo.branches, syncRepo.branches)
            return setBranchesInRepo(prev, syncRepo.id, merged)
          })
        } else {
          // Check for individual branch updates (status, prUrl, messages)
          for (const syncBranch of syncRepo.branches) {
            const lastBranch = lastBranchMap.get(syncBranch.id)
            if (!lastBranch) continue

            // Status change
            if (lastBranch.status !== syncBranch.status) {
              setRepos((prev) =>
                updateBranchAcrossRepos(prev, syncBranch.id, {
                  status: syncBranch.status as Branch["status"],
                })
              )
            }

            // PR URL change
            if (!lastBranch.prUrl && syncBranch.prUrl) {
              setRepos((prev) =>
                updateBranchAcrossRepos(prev, syncBranch.id, {
                  prUrl: syncBranch.prUrl || undefined,
                })
              )
            }

            // New message detection
            const lastKnownMessageId = lastMessageIdsRef.current.get(syncBranch.id)
            if (syncBranch.lastMessageId && syncBranch.lastMessageId !== lastKnownMessageId) {
              lastMessageIdsRef.current.set(syncBranch.id, syncBranch.lastMessageId)

              // For non-active branches, just track the change in the ref - no state update needed.
              // The unread indicator can be derived when rendering the sidebar.
              // This avoids re-rendering the entire app every time a running agent produces a message.
              if (syncBranch.id === activeBranchIdRef.current) {
                // CRITICAL: Skip message reload if a message is currently being streamed
                // This prevents sync from overwriting streaming content with stale DB data
                // The polling mechanism handles real-time updates during streaming
                if (streamingMessageIdRef?.current) {
                  // Skip this sync cycle - streaming is in progress
                  return
                }

                // Reload messages for active branch
                fetch(`/api/branches/messages?branchId=${syncBranch.id}`)
                  .then((r) => r.json())
                  .then((msgData) => {
                    // Double-check streaming hasn't started while we were fetching
                    if (streamingMessageIdRef?.current) {
                      return
                    }
                    if (msgData.messages) {
                      setRepos((prev) =>
                        updateBranchAcrossRepos(prev, syncBranch.id, {
                          messages: mergeMessages(
                            prev.find((r) =>
                              r.branches.some((b) => b.id === syncBranch.id)
                            )?.branches.find((b) => b.id === syncBranch.id)?.messages || [],
                            msgData.messages
                          ),
                        })
                      )
                    }
                  })
                  .catch(() => {})
              }
            }
          }
        }
      }
    }

    // Update message ID tracking for next sync
    for (const repo of data.repos) {
      for (const branch of repo.branches) {
        lastMessageIdsRef.current.set(branch.id, branch.lastMessageId)
      }
    }
  }, [setRepos, activeBranchIdRef, streamingMessageIdRef])

  return {
    handleSyncData,
    lastMessageIdsRef,
  }
}

/**
 * Prefer local message when it has more streamed content than API (avoids sync
 * overwriting in-progress or just-finished streamed content with stale DB data).
 */
function isLocalRicher(
  local: Branch["messages"][0],
  api: { content: string; toolCalls?: unknown[]; contentBlocks?: unknown[] }
): boolean {
  if ((local.content?.length ?? 0) > (api.content?.length ?? 0)) return true
  const localTc = local.toolCalls?.length ?? 0
  const apiTc = api.toolCalls?.length ?? 0
  if (localTc > apiTc) return true
  const localBlocks = local.contentBlocks?.length ?? 0
  const apiBlocks = api.contentBlocks?.length ?? 0
  if (localBlocks > apiBlocks) return true
  return false
}

/**
 * Merges API messages with local optimistic messages.
 * For messages present in both, keeps the richer version (longer content / more
 * toolCalls/contentBlocks) so sync does not overwrite streamed content with stale DB.
 */
function mergeMessages(
  localMessages: Branch["messages"],
  apiMessages: DbMessage[]
): Branch["messages"] {
  const convertedApiMessages = apiMessages.map((m: DbMessage) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    toolCalls: m.toolCalls as import("@/lib/types").Message["toolCalls"],
    contentBlocks: m.contentBlocks as import("@/lib/types").Message["contentBlocks"],
    timestamp: m.timestamp || "",
    commitHash: m.commitHash || undefined,
    commitMessage: m.commitMessage || undefined,
  }))
  const localById = new Map(localMessages.map((m) => [m.id, m]))
  const apiMessageIds = new Set(convertedApiMessages.map((m) => m.id))
  const optimisticMessages = localMessages.filter((m) => !apiMessageIds.has(m.id))

  const merged = convertedApiMessages.map((apiMsg) => {
    const local = localById.get(apiMsg.id)
    if (local && isLocalRicher(local, apiMsg)) return local
    return apiMsg
  })
  return [...merged, ...optimisticMessages]
}

export type SyncDataHandler = ReturnType<typeof useSyncData>
