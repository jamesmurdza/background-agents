"use client"

import { useCallback, useRef, useEffect, useState } from "react"
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
import { isBranchPolling } from "@/hooks/use-execution-poller"

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
 * Manages fetching and state for repos, quota, and credentials.
 * Uses TanStack Query for initial fetch and quota/credentials,
 * but local state for repos to avoid transform/untransform issues during streaming.
 */
export function useRepoData({ isAuthenticated }: UseRepoDataOptions) {
  const queryClient = useQueryClient()

  // Local state for repos - avoids transform/untransform issues with TanStack Query cache
  const [repos, setRepos] = useState<TransformedRepo[]>([])
  const [loaded, setLoaded] = useState(false)

  // Per-branch request sequencing to ignore stale/out-of-order responses.
  const messageLoadSeqRef = useRef(new Map<string, number>())
  const [loadingMessageBranchIds, setLoadingMessageBranchIds] = useState<Set<string>>(new Set())

  // Keep a ref to repos for callbacks that need current value without re-creating
  const reposRef = useRef(repos)
  reposRef.current = repos

  // Main user data query - only for initial fetch and quota/credentials
  const {
    data: userData,
    isSuccess,
  } = useQuery({
    queryKey: queryKeys.user.me(),
    queryFn: fetchUserMe,
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  // Initialize repos from query data on first success
  useEffect(() => {
    if (!isSuccess || !userData?.repos || loaded) return

    const transformedRepos = userData.repos.map(transformRepo)
    setRepos(transformedRepos)
    setLoaded(true)

    // Load message summaries for running branches
    const runningBranches = transformedRepos.flatMap((r) =>
      r.branches
        .filter((b) => b.status === BRANCH_STATUS.RUNNING)
        .map((b) => ({ repoId: r.id, branch: b }))
    )

    if (runningBranches.length === 0) return

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
        setRepos((prev) =>
          prev.map((r) => {
            const branchUpdates = validResults.filter((u) => u.repoId === r.id)
            if (branchUpdates.length === 0) return r
            return {
              ...r,
              branches: r.branches.map((b) => {
                const update = branchUpdates.find((u) => u.branchId === b.id)
                if (!update) return b
                return {
                  ...b,
                  messages: update.messages.map(transformMessageSummary),
                }
              }),
            }
          })
        )
      }
    })
  }, [isSuccess, userData?.repos, loaded])

  // Refresh user data from server - refetches and resets local state
  const refresh = useCallback(() => {
    setLoaded(false) // Allow re-initialization from query
    queryClient.invalidateQueries({ queryKey: queryKeys.user.me() })
  }, [queryClient])

  // Refresh just quota without resetting repos (uses lightweight endpoint)
  const refreshQuotaOnly = useCallback(async () => {
    try {
      const quota = await apiFetch<Quota>("/api/user/quota")
      queryClient.setQueryData<UserMeResponse>(queryKeys.user.me(), (old) => {
        if (!old) return old
        return { ...old, quota }
      })
    } catch (err) {
      console.error("Failed to refresh quota:", err)
    }
  }, [queryClient])

  // Load messages for a specific branch
  const loadBranchMessages = useCallback(
    async (branchId: string, repoId: string, skipIfHasMessages: boolean = true) => {
      const currentRepos = reposRef.current
      const repo = currentRepos.find((r) => r.id === repoId)
      const branch = repo?.branches.find((b) => b.id === branchId)
      if (!branch) return

      if (isBranchPolling(branchId)) {
        return
      }

      // Skip if we already have messages with full content loaded.
      // Exception: if a model assistant message has empty content while branch
      // is idle, the content is stale (agent completed while we were on another
      // branch) and must be re-fetched.
      const hasFullContent =
        branch.messages.length > 0 && branch.messages.every((m) => m.contentLoaded !== false)
      const hasStaleAssistant = branch.status !== "running" && branch.messages.some(
        (m) => m.role === "assistant" && m.assistantSource === "model" && !m.content
      )
      if (skipIfHasMessages && hasFullContent && !hasStaleAssistant) return

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

        if (isBranchPolling(branchId)) {
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
                  return {
                    ...b,
                    messages: data.messages.map(transformMessage),
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
    []
  )

  return {
    // State
    repos,
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
    loaded,
    messagesLoading: loadingMessageBranchIds.size > 0,
    messagesLoadingBranchIds: loadingMessageBranchIds,

    // Actions
    refresh,
    refreshQuotaOnly,
    loadBranchMessages,
  }
}

export type RepoData = ReturnType<typeof useRepoData>
