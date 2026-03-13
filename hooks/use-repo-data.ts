import { useState, useEffect, useCallback, useRef } from "react"
import {
  DbMessage,
  DbRepo,
  Quota,
  UserCredentials,
  TransformedRepo,
  transformRepo,
  transformMessage,
} from "@/lib/db-types"
import { BRANCH_STATUS } from "@/lib/constants"

interface UseRepoDataOptions {
  isAuthenticated: boolean
}

/**
 * Manages fetching and state for repos, quota, and credentials
 */
export function useRepoData({ isAuthenticated }: UseRepoDataOptions) {
  const [repos, setRepos] = useState<TransformedRepo[]>([])
  // Keep a ref to repos for callbacks that need to read current value without re-creating
  const reposRef = useRef(repos)
  reposRef.current = repos
  const [quota, setQuota] = useState<Quota | null>(null)
  const [credentials, setCredentials] = useState<UserCredentials | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)

  // Fetch user data on mount
  useEffect(() => {
    if (!isAuthenticated) return

    fetch("/api/user/me", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch user data: ${r.status}`)
        return r.json()
      })
      .then(async (data) => {
        if (data.repos) {
          const transformedRepos = data.repos.map(transformRepo)
          setRepos(transformedRepos)

          // Eagerly load messages for any running branches to prevent race conditions
          // This ensures messages are available when chat-panel checks for active executions
          const runningBranches = transformedRepos.flatMap((r: TransformedRepo) =>
            r.branches.filter((b) => b.status === BRANCH_STATUS.RUNNING).map((b) => ({ repoId: r.id, branch: b }))
          )

          if (runningBranches.length > 0) {
            // Load messages for all running branches in parallel
            const messagePromises = runningBranches.map(async ({ repoId, branch }: { repoId: string; branch: { id: string } }) => {
              try {
                const res = await fetch(`/api/branches/messages?branchId=${branch.id}`)
                if (!res.ok) return null
                const msgData = await res.json()
                return { repoId, branchId: branch.id, messages: msgData.messages || [] }
              } catch {
                return null
              }
            })

            const results = await Promise.all(messagePromises)
            const validResults = results.filter((r): r is { repoId: string; branchId: string; messages: DbMessage[] } => r !== null && r.messages.length > 0)

            if (validResults.length > 0) {
              setRepos((prev) =>
                prev.map((r) => {
                  const branchUpdates = validResults.filter(u => u.repoId === r.id)
                  if (branchUpdates.length === 0) return r
                  return {
                    ...r,
                    branches: r.branches.map((b) => {
                      const update = branchUpdates.find(u => u.branchId === b.id)
                      if (!update) return b
                      return {
                        ...b,
                        messages: update.messages.map(transformMessage),
                      }
                    }),
                  }
                })
              )
            }
          }
        }
        if (data.quota) {
          setQuota(data.quota)
        }
        if (data.credentials) {
          setCredentials(data.credentials)
        }
        setLoaded(true)
      })
      .catch((err) => {
        console.error("Failed to fetch user data:", err)
        setLoaded(true)
      })
  }, [isAuthenticated])

  // Refresh quota from server
  const refreshQuota = useCallback(() => {
    fetch("/api/user/quota")
      .then((r) => r.json())
      .then((q) => setQuota(q))
      .catch(() => {})
  }, [])

  // Refresh credentials from server
  const refreshCredentials = useCallback(() => {
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.credentials) {
          setCredentials(data.credentials)
        }
      })
      .catch(() => {})
  }, [])

  // Load messages for a specific branch
  // Uses reposRef to avoid recreating this callback when repos changes,
  // which would cause unnecessary refetches via the useEffect in app/page.tsx
  const loadBranchMessages = useCallback(async (
    branchId: string,
    repoId: string,
    skipIfHasMessages: boolean = true
  ) => {
    // Check if branch already has messages (read from ref to avoid dependency)
    const repo = reposRef.current.find((r) => r.id === repoId)
    const branch = repo?.branches.find((b) => b.id === branchId)
    if (!branch) return
    if (skipIfHasMessages && branch.messages.length > 0) return

    setMessagesLoading(true)
    try {
      const res = await fetch(`/api/branches/messages?branchId=${branchId}`)
      if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`)
      const data = await res.json()

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
      setMessagesLoading(false)
    }
  }, [])

  return {
    // State
    repos,
    setRepos,
    quota,
    setQuota,
    credentials,
    setCredentials,
    loaded,
    messagesLoading,

    // Actions
    refreshQuota,
    refreshCredentials,
    loadBranchMessages,
  }
}

export type RepoData = ReturnType<typeof useRepoData>
