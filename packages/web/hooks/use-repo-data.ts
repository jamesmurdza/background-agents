"use client"

import { useCallback, useRef, useEffect, useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DbMessage,
  DbMessageSummary,
  DbRepo,
  Quota,
  UserCredentials,
  TransformedRepo,
  transformRepo,
  transformMessage,
  transformMessageSummary,
} from "@/lib/db/db-types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import { queryKeys } from "@/lib/api/query-keys"
import { apiFetch } from "@/lib/api/fetcher"

/**
 * Response shape from /api/user/me
 */
interface UserMeResponse {
  user: {
    id: string
    name: string
    email: string
    isAdmin?: boolean
  }
  repos: DbRepo[]
  quota: Quota
  credentials: UserCredentials
}

/**
 * Response shape from /api/branches/messages
 */
interface BranchMessagesResponse<T = DbMessage> {
  messages: T[]
  pagination: {
    totalCount: number
    hasMore: boolean
    nextCursor: string | null
  }
}

/**
 * Fetch user data from /api/user/me
 */
async function fetchUserMe(): Promise<UserMeResponse> {
  return apiFetch<UserMeResponse>("/api/user/me")
}

/**
 * Fetch messages for a branch
 */
async function fetchBranchMessages(branchId: string, summary: true): Promise<BranchMessagesResponse<DbMessageSummary>>
async function fetchBranchMessages(branchId: string, summary?: false): Promise<BranchMessagesResponse<DbMessage>>
async function fetchBranchMessages(branchId: string, summary: boolean = false): Promise<BranchMessagesResponse<DbMessage | DbMessageSummary>> {
  const url = summary
    ? `/api/branches/messages?branchId=${branchId}&summary=true`
    : `/api/branches/messages?branchId=${branchId}`
  return apiFetch<BranchMessagesResponse<DbMessage | DbMessageSummary>>(url)
}

interface UseRepoDataOptions {
  isAuthenticated: boolean
}

/**
 * Manages fetching and state for repos, quota, and credentials using TanStack Query
 */
export function useRepoData({ isAuthenticated }: UseRepoDataOptions) {
  const queryClient = useQueryClient()

  // Per-branch request sequencing to ignore stale/out-of-order responses.
  const messageLoadSeqRef = useRef(new Map<string, number>())
  const [loadingMessageBranchIds, setLoadingMessageBranchIds] = useState<Set<string>>(new Set())

  // Main user data query
  const {
    data: userData,
    isLoading,
    isSuccess,
  } = useQuery({
    queryKey: queryKeys.user.me(),
    queryFn: fetchUserMe,
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  // Transform repos from API response - memoized to prevent unnecessary re-renders
  const transformedRepos = useMemo(
    () => userData?.repos?.map(transformRepo) ?? [],
    [userData?.repos]
  )

  // Store repos in ref for callbacks that need current value
  const reposRef = useRef<TransformedRepo[]>(transformedRepos)
  reposRef.current = transformedRepos

  // Load message summaries for running branches on initial load
  useEffect(() => {
    if (!isSuccess || !userData?.repos) return

    const transformed = userData.repos.map(transformRepo)
    const runningBranches = transformed.flatMap((r) =>
      r.branches
        .filter((b) => b.status === BRANCH_STATUS.RUNNING)
        .map((b) => ({ repoId: r.id, branch: b }))
    )

    if (runningBranches.length === 0) return

    // Load message summaries for running branches
    Promise.all(
      runningBranches.map(async ({ repoId, branch }) => {
        try {
          const msgData = await fetchBranchMessages(branch.id, true)
          return { repoId, branchId: branch.id, messages: msgData.messages || [] }
        } catch {
          return null
        }
      })
    ).then((results) => {
      const validResults = results.filter(
        (r): r is { repoId: string; branchId: string; messages: DbMessageSummary[] } =>
          r !== null && r.messages.length > 0
      )

      if (validResults.length > 0) {
        // Update the cache with message summaries
        queryClient.setQueryData<UserMeResponse>(queryKeys.user.me(), (old) => {
          if (!old) return old
          return {
            ...old,
            repos: old.repos.map((repo) => {
              const branchUpdates = validResults.filter((u) => u.repoId === repo.id)
              if (branchUpdates.length === 0) return repo
              return {
                ...repo,
                branches: (repo as any).branches?.map((b: any) => {
                  const update = branchUpdates.find((u) => u.branchId === b.id)
                  if (!update) return b
                  return {
                    ...b,
                    messages: update.messages,
                  }
                }),
              }
            }),
          }
        })
      }
    })
  }, [isSuccess, userData?.repos, queryClient])

  // Refresh user data (quota, credentials, repos) from server
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
  }, [queryClient])

  // Get repos with setter that updates the cache
  const setRepos = useCallback(
    (updater: React.SetStateAction<TransformedRepo[]>) => {
      queryClient.setQueryData<UserMeResponse>(queryKeys.user.me(), (old) => {
        if (!old) return old
        const currentRepos = old.repos.map(transformRepo)
        const newRepos = typeof updater === "function" ? updater(currentRepos) : updater

        // Convert back to DbRepo format for cache
        return {
          ...old,
          repos: newRepos.map((r) => ({
            id: r.id,
            name: r.name,
            owner: r.owner,
            avatar: r.avatar,
            defaultBranch: r.defaultBranch,
            branches: r.branches.map((b) => ({
              id: b.id,
              name: b.name,
              status: b.status,
              baseBranch: b.baseBranch,
              prUrl: b.prUrl || null,
              agent: b.agent || null,
              model: b.model || null,
              draftPrompt: b.draftPrompt || null,
              loopEnabled: b.loopEnabled ?? false,
              loopCount: b.loopCount ?? 0,
              loopMaxIterations: b.loopMaxIterations ?? 10,
              startCommit: b.startCommit || null,
              lastShownCommitHash: b.lastShownCommitHash || null,
              // Required fields for DbBranch
              updatedAt: b.lastActivityTs ? new Date(b.lastActivityTs).toISOString() : new Date().toISOString(),
              sandbox: b.sandboxId ? {
                id: b.sandboxId,
                sandboxId: b.sandboxId,
                contextId: b.contextId || null,
                sessionId: b.sessionId || null,
                previewUrlPattern: b.previewUrlPattern || null,
                status: "running",
              } : null,
              messages: b.messages,
            })),
          })) as DbRepo[],
        }
      })
    },
    [queryClient]
  )

  // Load messages for a specific branch
  const loadBranchMessages = useCallback(
    async (branchId: string, repoId: string, skipIfHasMessages: boolean = true) => {
      // Check if branch already has FULL messages
      const repos = reposRef.current
      const repo = repos.find((r) => r.id === repoId)
      const branch = repo?.branches.find((b) => b.id === branchId)
      if (!branch) return

      // Skip if we already have messages with full content loaded
      const hasFullContent =
        branch.messages.length > 0 && branch.messages.every((m) => m.contentLoaded !== false)
      if (skipIfHasMessages && hasFullContent) return

      const seq = (messageLoadSeqRef.current.get(branchId) || 0) + 1
      messageLoadSeqRef.current.set(branchId, seq)
      setLoadingMessageBranchIds((prev) => {
        const next = new Set(prev)
        next.add(branchId)
        return next
      })

      try {
        const data = await fetchBranchMessages(branchId, false)
        if (messageLoadSeqRef.current.get(branchId) !== seq) {
          return
        }

        if (data.messages && data.messages.length > 0) {
          setRepos((prev) =>
            prev.map((r) => {
              if (r.id !== repoId) return r
              return {
                ...r,
                branches: r.branches.map((b) => {
                  if (b.id !== branchId) return b

                  // Merge API messages with local messages to preserve optimistic updates
                  const apiMessages = data.messages.map(transformMessage)
                  const apiMessageIds = new Set(apiMessages.map((m) => m.id))

                  // Keep any local messages that aren't in the API response yet
                  // (these are optimistically added messages pending server sync)
                  const localOnlyMessages = b.messages.filter(
                    (m) => !apiMessageIds.has(m.id)
                  )

                  return {
                    ...b,
                    messages: [...apiMessages, ...localOnlyMessages],
                  }
                }),
              }
            })
          )
        }
      } catch (err) {
        console.error("Failed to load messages:", err)
      } finally {
        if (messageLoadSeqRef.current.get(branchId) === seq) {
          setLoadingMessageBranchIds((prev) => {
            const next = new Set(prev)
            next.delete(branchId)
            return next
          })
        }
      }
    },
    [setRepos]
  )

  return {
    // State
    repos: transformedRepos,
    setRepos,
    quota: userData?.quota ?? null,
    setQuota: (quota: Quota | null) => {
      queryClient.setQueryData<UserMeResponse>(queryKeys.user.me(), (old) => {
        if (!old) return old
        return { ...old, quota: quota! }
      })
    },
    credentials: userData?.credentials ?? null,
    setCredentials: (credentials: UserCredentials | null) => {
      queryClient.setQueryData<UserMeResponse>(queryKeys.user.me(), (old) => {
        if (!old) return old
        return { ...old, credentials: credentials! }
      })
    },
    isAdmin: userData?.user?.isAdmin ?? false,
    loaded: isSuccess,
    messagesLoading: loadingMessageBranchIds.size > 0,
    messagesLoadingBranchIds: loadingMessageBranchIds,

    // Actions
    refresh,
    loadBranchMessages,
  }
}

export type RepoData = ReturnType<typeof useRepoData>
