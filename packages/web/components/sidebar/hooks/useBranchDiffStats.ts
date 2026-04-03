import { useState, useEffect, useRef, useCallback } from "react"
import type { Branch } from "@/lib/shared/types"

export interface DiffStats {
  additions: number
  deletions: number
}

interface UseBranchDiffStatsOptions {
  branches: Branch[]
  repoOwner: string
  repoName: string
}

/**
 * Fetches and caches diff stats for branches that have sandboxes.
 * Only fetches for branches with sandboxId (active branches).
 */
export function useBranchDiffStats({
  branches,
  repoOwner,
  repoName,
}: UseBranchDiffStatsOptions) {
  // Map of branchId -> diffStats
  const [diffStatsMap, setDiffStatsMap] = useState<Map<string, DiffStats>>(new Map())
  // Track which branches we've already fetched to avoid duplicate requests
  const fetchedRef = useRef<Set<string>>(new Set())
  // Track in-flight requests
  const pendingRef = useRef<Set<string>>(new Set())

  const fetchDiffStats = useCallback(async (branch: Branch) => {
    if (!branch.sandboxId || !branch.baseBranch) return
    if (fetchedRef.current.has(branch.id) || pendingRef.current.has(branch.id)) return

    pendingRef.current.add(branch.id)

    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoName,
          base: branch.baseBranch,
          head: branch.name,
        }),
      })

      if (!res.ok) {
        fetchedRef.current.add(branch.id)
        pendingRef.current.delete(branch.id)
        return
      }

      const data = await res.json()
      const hasDiff = data.diff && data.diff.trim() !== "" && data.diff !== "No differences found."

      if (hasDiff && data.diff) {
        const lines = data.diff.split("\n")
        let additions = 0
        let deletions = 0
        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            additions++
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++
          }
        }

        if (additions > 0 || deletions > 0) {
          setDiffStatsMap(prev => {
            const next = new Map(prev)
            next.set(branch.id, { additions, deletions })
            return next
          })
        }
      }

      fetchedRef.current.add(branch.id)
    } catch {
      // Ignore errors
    } finally {
      pendingRef.current.delete(branch.id)
    }
  }, [repoOwner, repoName])

  // Fetch diff stats for branches with sandboxes
  useEffect(() => {
    const branchesWithSandbox = branches.filter(b => b.sandboxId && b.baseBranch)
    for (const branch of branchesWithSandbox) {
      fetchDiffStats(branch)
    }
  }, [branches, fetchDiffStats])

  // Method to refresh stats for a specific branch (e.g., after status change)
  const refreshBranch = useCallback((branchId: string) => {
    fetchedRef.current.delete(branchId)
    const branch = branches.find(b => b.id === branchId)
    if (branch) {
      fetchDiffStats(branch)
    }
  }, [branches, fetchDiffStats])

  // Method to clear cache for a branch (e.g., when deleted)
  const clearBranch = useCallback((branchId: string) => {
    fetchedRef.current.delete(branchId)
    setDiffStatsMap(prev => {
      const next = new Map(prev)
      next.delete(branchId)
      return next
    })
  }, [])

  return {
    diffStatsMap,
    refreshBranch,
    clearBranch,
  }
}
