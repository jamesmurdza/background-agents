import { useCallback, useRef } from "react"
import type { Branch } from "@/lib/types"
import type { TransformedRepo, DbMessage } from "@/lib/db-types"

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
}

/**
 * Provides the sync data handler for cross-device sync
 * Detects changes from other devices and updates local state
 */
export function useSyncData({ setRepos, activeBranchIdRef }: UseSyncDataOptions) {
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
        const newRepos = data.repos.map((syncRepo) => {
          // Try to preserve existing local data (messages, etc)
          const existing = prev.find((r) => r.id === syncRepo.id)
          if (existing) {
            // Update branches while preserving messages
            return {
              ...existing,
              branches: syncRepo.branches.map((syncBranch) => {
                const existingBranch = existing.branches.find((b) => b.id === syncBranch.id)
                if (existingBranch) {
                  return {
                    ...existingBranch,
                    status: syncBranch.status as Branch["status"],
                    prUrl: syncBranch.prUrl || undefined,
                    sandboxId: syncBranch.sandboxId || undefined,
                  }
                }
                // New branch from sync
                return {
                  id: syncBranch.id,
                  name: syncBranch.name,
                  status: syncBranch.status as Branch["status"],
                  baseBranch: syncBranch.baseBranch || "main",
                  prUrl: syncBranch.prUrl || undefined,
                  sandboxId: syncBranch.sandboxId || undefined,
                  messages: [],
                }
              }),
            }
          }
          // New repo from sync
          return {
            id: syncRepo.id,
            name: syncRepo.name,
            owner: syncRepo.owner,
            avatar: syncRepo.avatar || "",
            defaultBranch: syncRepo.defaultBranch,
            branches: syncRepo.branches.map((b) => ({
              id: b.id,
              name: b.name,
              status: b.status as Branch["status"],
              baseBranch: b.baseBranch || "main",
              prUrl: b.prUrl || undefined,
              sandboxId: b.sandboxId || undefined,
              messages: [],
            })),
          }
        })
        return newRepos
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
          // Update this repo's branches
          setRepos((prev) =>
            prev.map((r) => {
              if (r.id !== syncRepo.id) return r
              return {
                ...r,
                branches: syncRepo.branches.map((syncBranch) => {
                  const existingBranch = r.branches.find((b) => b.id === syncBranch.id)
                  if (existingBranch) {
                    return {
                      ...existingBranch,
                      status: syncBranch.status as Branch["status"],
                      prUrl: syncBranch.prUrl || undefined,
                    }
                  }
                  return {
                    id: syncBranch.id,
                    name: syncBranch.name,
                    status: syncBranch.status as Branch["status"],
                    baseBranch: syncBranch.baseBranch || "main",
                    prUrl: syncBranch.prUrl || undefined,
                    sandboxId: syncBranch.sandboxId || undefined,
                    messages: [],
                  }
                }),
              }
            })
          )
        } else {
          // Check for individual branch updates (status, prUrl, messages)
          for (const syncBranch of syncRepo.branches) {
            const lastBranch = lastBranchMap.get(syncBranch.id)
            if (!lastBranch) continue

            // Status change
            if (lastBranch.status !== syncBranch.status) {
              setRepos((prev) =>
                prev.map((r) => ({
                  ...r,
                  branches: r.branches.map((b) =>
                    b.id === syncBranch.id ? { ...b, status: syncBranch.status as Branch["status"] } : b
                  ),
                }))
              )
            }

            // PR URL change
            if (!lastBranch.prUrl && syncBranch.prUrl) {
              setRepos((prev) =>
                prev.map((r) => ({
                  ...r,
                  branches: r.branches.map((b) =>
                    b.id === syncBranch.id ? { ...b, prUrl: syncBranch.prUrl || undefined } : b
                  ),
                }))
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
                // Reload messages for active branch
                fetch(`/api/branches/messages?branchId=${syncBranch.id}`)
                  .then((r) => r.json())
                  .then((msgData) => {
                    if (msgData.messages) {
                      setRepos((prev) =>
                        prev.map((r) => ({
                          ...r,
                          branches: r.branches.map((b) => {
                            if (b.id !== syncBranch.id) return b
                            return {
                              ...b,
                              messages: msgData.messages.map((m: DbMessage) => ({
                                id: m.id,
                                role: m.role as "user" | "assistant",
                                content: m.content,
                                toolCalls: m.toolCalls as import("@/lib/types").Message["toolCalls"],
                                contentBlocks: m.contentBlocks as import("@/lib/types").Message["contentBlocks"],
                                timestamp: m.timestamp || "",
                                commitHash: m.commitHash || undefined,
                                commitMessage: m.commitMessage || undefined,
                              })),
                            }
                          }),
                        }))
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
  }, [setRepos, activeBranchIdRef])

  return {
    handleSyncData,
    lastMessageIdsRef,
  }
}

export type SyncDataHandler = ReturnType<typeof useSyncData>
